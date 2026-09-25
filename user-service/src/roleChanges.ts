import { addOutboxEvent, USER_EVENTS } from '@foc/shared-events';
import { conflict, forbidden, notFound, type Page } from '@foc/shared-middleware';
import type { AppContext } from './context.js';
import { LOCKS, mapUniqueViolation, withTransaction } from './db.js';
import { countActiveAdmins, findUserById, writeAudit, type Role } from './users.js';

interface RoleChangeRow {
  id: string;
  target_user_id: string;
  from_role: Role;
  to_role: Role;
  reason: string | null;
  requested_by: string;
  decided_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: Date;
  decided_at: Date | null;
  target_username?: string;
  requested_by_username?: string;
  decided_by_username?: string | null;
}

const toView = (r: RoleChangeRow) => ({
  id: r.id,
  targetUserId: r.target_user_id,
  targetUsername: r.target_username,
  fromRole: r.from_role,
  toRole: r.to_role,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedByUsername: r.requested_by_username,
  decidedBy: r.decided_by,
  decidedByUsername: r.decided_by_username ?? null,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export type RoleChangeView = ReturnType<typeof toView>;

const lastAdmin = () =>
  conflict('LAST_ADMIN', 'This would leave the platform with no active administrator. Promote another admin first.');

const SELECT_WITH_NAMES = `
  SELECT r.*, t.username AS target_username, q.username AS requested_by_username, d.username AS decided_by_username
  FROM role_change_requests r
  JOIN users t ON t.id = r.target_user_id
  JOIN users q ON q.id = r.requested_by
  LEFT JOIN users d ON d.id = r.decided_by`;

async function loadView(ctx: AppContext, id: string): Promise<RoleChangeView> {
  const { rows } = await ctx.pool.query<RoleChangeRow>(`${SELECT_WITH_NAMES} WHERE r.id = $1`, [id]);
  if (!rows[0]) throw notFound('ROLE_CHANGE_NOT_FOUND', 'Role change request not found.');
  return toView(rows[0]);
}

/** Step 1 of the two-admin workflow (F1.1.8, F29.2): an admin REQUESTS a change. Nothing changes yet. */
export async function requestRoleChange(
  ctx: AppContext,
  actorId: string,
  input: { targetUserId: string; newRole: Role; reason?: string },
): Promise<RoleChangeView> {
  const id = await withTransaction(ctx.pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [LOCKS.roleChanges]);
    const target = await findUserById(db, input.targetUserId, true);
    if (!target) throw notFound('USER_NOT_FOUND', 'User not found.');
    if (target.role === input.newRole) throw conflict('ROLE_UNCHANGED', `This user is already ${input.newRole === 'admin' ? 'an admin' : 'a regular user'}.`);
    if (target.status !== 'active') throw conflict('USER_SUSPENDED', 'Reinstate this user before changing their role.');
    // Fail early: a demotion that could never be confirmed (only one admin) is refused now.
    if (input.newRole === 'user' && (await countActiveAdmins(db)) <= 1) throw lastAdmin();
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO role_change_requests (target_user_id, from_role, to_role, reason, requested_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [target.id, target.role, input.newRole, input.reason ?? null, actorId],
      );
      await writeAudit(db, {
        adminId: actorId,
        action: 'ROLE_CHANGE_REQUESTED',
        targetType: 'user',
        targetId: target.id,
        details: { requestId: rows[0]!.id, fromRole: target.role, toRole: input.newRole, reason: input.reason ?? null },
      });
      return rows[0]!.id;
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  });
  return loadView(ctx, id);
}

/**
 * Step 2: a DIFFERENT admin confirms. Applies the role in Keycloak, mirrors it in users.role, ends the target's
 * sessions (so their next token carries the new role immediately, F6.5), audits both admins and emits UserRoleChanged.
 * Serialised by an advisory lock so two confirmations can never both remove "the last admin".
 */
export async function confirmRoleChange(ctx: AppContext, actorId: string, requestId: string, correlationId?: string) {
  let targetId = '';
  let keycloakChanged: { userId: string; role: Role } | null = null;
  try {
    await withTransaction(ctx.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock($1)', [LOCKS.roleChanges]);
      const { rows } = await db.query<RoleChangeRow>('SELECT * FROM role_change_requests WHERE id = $1 FOR UPDATE', [requestId]);
      const req = rows[0];
      if (!req) throw notFound('ROLE_CHANGE_NOT_FOUND', 'Role change request not found.');
      if (req.status !== 'pending') throw conflict('ROLE_CHANGE_NOT_PENDING', `This request was already ${req.status}.`);
      if (req.requested_by === actorId) {
        throw forbidden('SAME_ADMIN_CANNOT_CONFIRM', 'A different administrator must confirm this request.');
      }
      const target = await findUserById(db, req.target_user_id, true);
      if (!target) throw notFound('USER_NOT_FOUND', 'User not found.');
      if (target.role !== req.from_role) throw conflict('ROLE_CHANGED_SINCE_REQUEST', 'The user role changed since this request was made.');
      if (target.status !== 'active') throw conflict('USER_SUSPENDED', 'Reinstate this user before changing their role.');
      if (req.to_role === 'user' && (await countActiveAdmins(db)) <= 1) throw lastAdmin();

      await ctx.kc.setRealmRole(target.id, 'admin', req.to_role === 'admin');
      keycloakChanged = { userId: target.id, role: req.from_role };
      await db.query('UPDATE users SET role = $2, updated_at = now() WHERE id = $1', [target.id, req.to_role]);
      await db.query(
        `UPDATE role_change_requests SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`,
        [req.id, actorId],
      );
      await writeAudit(db, {
        adminId: actorId,
        counterpartAdminId: req.requested_by,
        action: req.to_role === 'admin' ? 'PROMOTE_ADMIN' : 'DEMOTE_ADMIN',
        targetType: 'user',
        targetId: target.id,
        details: { requestId: req.id, requestedBy: req.requested_by, approvedBy: actorId, fromRole: req.from_role, toRole: req.to_role },
      });
      await addOutboxEvent(
        db,
        USER_EVENTS.roleChanged,
        { userId: target.id, oldRole: req.from_role, newRole: req.to_role, requestedBy: req.requested_by, approvedBy: actorId },
        correlationId,
      );
      targetId = target.id;
    });
  } catch (err) {
    // Keycloak was changed but the DB transaction rolled back: put Keycloak back.
    const changed = keycloakChanged as { userId: string; role: Role } | null;
    if (changed) {
      await ctx.kc
        .setRealmRole(changed.userId, 'admin', changed.role === 'admin')
        .catch((e) => ctx.logger.error({ err: e, userId: changed.userId }, 'Could not revert Keycloak role'));
    }
    throw err;
  }
  await ctx.kc.logoutUser(targetId).catch((err) => ctx.logger.warn({ err, targetId }, 'Could not end sessions after role change'));
  ctx.sessions.purgeUser(targetId);
  return loadView(ctx, requestId);
}

/** Any admin can reject a pending request; the requester rejecting it = cancelling it. */
export async function rejectRoleChange(ctx: AppContext, actorId: string, requestId: string) {
  await withTransaction(ctx.pool, async (db) => {
    const { rows } = await db.query<RoleChangeRow>('SELECT * FROM role_change_requests WHERE id = $1 FOR UPDATE', [requestId]);
    const req = rows[0];
    if (!req) throw notFound('ROLE_CHANGE_NOT_FOUND', 'Role change request not found.');
    if (req.status !== 'pending') throw conflict('ROLE_CHANGE_NOT_PENDING', `This request was already ${req.status}.`);
    await db.query(`UPDATE role_change_requests SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [
      req.id,
      actorId,
    ]);
    await writeAudit(db, {
      adminId: actorId,
      counterpartAdminId: req.requested_by,
      action: req.requested_by === actorId ? 'ROLE_CHANGE_CANCELLED' : 'ROLE_CHANGE_REJECTED',
      targetType: 'user',
      targetId: req.target_user_id,
      details: { requestId: req.id, fromRole: req.from_role, toRole: req.to_role },
    });
  });
  return loadView(ctx, requestId);
}

export async function listRoleChanges(
  ctx: AppContext,
  q: { status?: string; page: number; limit: number },
): Promise<Page<RoleChangeView>> {
  const where = q.status ? 'WHERE r.status = $1' : '';
  const params: unknown[] = q.status ? [q.status] : [];
  const total = await ctx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM role_change_requests r ${where}`, params);
  const { rows } = await ctx.pool.query<RoleChangeRow>(
    `${SELECT_WITH_NAMES} ${where} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, (q.page - 1) * q.limit],
  );
  return { data: rows.map(toView), page: q.page, limit: q.limit, total: Number(total.rows[0]!.n) };
}
