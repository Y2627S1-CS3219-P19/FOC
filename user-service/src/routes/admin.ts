import { Router } from 'express';
import { addOutboxEvent, USER_EVENTS } from '@foc/shared-events';
import { conflict, notFound, parseOrThrow, requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import { confirmRoleChange, listRoleChanges, rejectRoleChange, requestRoleChange } from '../roleChanges.js';
import {
  adminUserQuerySchema,
  auditQuerySchema,
  idParamSchema,
  roleChangeQuerySchema,
  roleChangeRequestSchema,
  suspendSchema,
} from '../schemas.js';
import { findUserById, toAdminView, writeAudit, type UserRow } from '../users.js';

/** Admin-only routes. Every route: valid token (401) -> live session, not suspended -> role admin (403). */
export function adminRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(ctx.auth.requireAuth, requireActiveSession(ctx.sessions), requireRole('admin'));

  // F30.1, F30.2: list/search/filter users.
  router.get('/users', async (req, res) => {
    const q = parseOrThrow(adminUserQuerySchema, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(username ILIKE $${params.length} OR email::text ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`role = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await ctx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM users ${clause}`, params);
    const { rows } = await ctx.pool.query<UserRow>(
      `SELECT * FROM users ${clause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, (q.page - 1) * q.limit],
    );
    res.json({ data: rows.map(toAdminView), page: q.page, limit: q.limit, total: Number(total.rows[0]!.n) });
  });

  router.get('/users/:id', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const user = await findUserById(ctx.pool, id);
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found.');
    res.json({ data: toAdminView(user) });
  });

  // F30.3, F4.2, F4.2.1: suspend with a stated reason; existing sessions end immediately.
  router.patch('/users/:id/suspend', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const { reason } = parseOrThrow(suspendSchema, req.body);
    const actorId = req.auth!.userId;
    const updated = await withTransaction(ctx.pool, async (db) => {
      const user = await findUserById(db, id, true);
      if (!user) throw notFound('USER_NOT_FOUND', 'User not found.');
      if (user.id === actorId) throw conflict('CANNOT_SUSPEND_SELF', 'You cannot suspend your own account.');
      if (user.role === 'admin') throw conflict('CANNOT_SUSPEND_ADMIN', 'Demote this administrator (two-admin workflow) before suspending them.');
      if (user.status === 'suspended') throw conflict('ALREADY_SUSPENDED', 'This account is already suspended.');
      const { rows } = await db.query<UserRow>(
        `UPDATE users SET status = 'suspended', suspension_reason = $2, suspended_at = now(), suspended_by = $3, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, reason, actorId],
      );
      await writeAudit(db, { adminId: actorId, action: 'SUSPEND_USER', targetType: 'user', targetId: id, details: { reason } });
      await addOutboxEvent(db, USER_EVENTS.suspended, { userId: id, suspendedBy: actorId, reason }, req.correlationId);
      return rows[0]!;
    });
    // End Keycloak sessions -> old tokens become inactive at once. The account stays enabled so the user can still
    // log in and read the suspension notice; every other action is then refused with 403 ACCOUNT_SUSPENDED.
    await ctx.kc.logoutUser(id).catch((err) => ctx.logger.warn({ err, id }, 'Could not end sessions of suspended user'));
    ctx.sessions.purgeUser(id);
    res.json({ data: toAdminView(updated) });
  });

  // F30.4: reinstate.
  router.patch('/users/:id/reinstate', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const actorId = req.auth!.userId;
    const updated = await withTransaction(ctx.pool, async (db) => {
      const user = await findUserById(db, id, true);
      if (!user) throw notFound('USER_NOT_FOUND', 'User not found.');
      if (user.status !== 'suspended') throw conflict('NOT_SUSPENDED', 'This account is not suspended.');
      const { rows } = await db.query<UserRow>(
        `UPDATE users SET status = 'active', suspension_reason = NULL, suspended_at = NULL, suspended_by = NULL, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      await writeAudit(db, { adminId: actorId, action: 'REINSTATE_USER', targetType: 'user', targetId: id });
      await addOutboxEvent(db, USER_EVENTS.reinstated, { userId: id, reinstatedBy: actorId }, req.correlationId);
      return rows[0]!;
    });
    ctx.sessions.purgeUser(id);
    res.json({ data: toAdminView(updated) });
  });

  // F1.1.8, F29.2: two-admin role change workflow.
  router.get('/role-changes', async (req, res) => {
    res.json(await listRoleChanges(ctx, parseOrThrow(roleChangeQuerySchema, req.query)));
  });

  router.post('/role-changes', async (req, res) => {
    const input = parseOrThrow(roleChangeRequestSchema, req.body);
    res.status(201).json({ data: await requestRoleChange(ctx, req.auth!.userId, input) });
  });

  router.post('/role-changes/:id/confirm', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    res.json({ data: await confirmRoleChange(ctx, req.auth!.userId, id, req.correlationId) });
  });

  router.post('/role-changes/:id/reject', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    res.json({ data: await rejectRoleChange(ctx, req.auth!.userId, id) });
  });

  // NFR18.2: immutable admin audit trail.
  router.get('/audit/actions', async (req, res) => {
    const q = parseOrThrow(auditQuerySchema, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.action) {
      params.push(q.action);
      where.push(`a.action = $${params.length}`);
    }
    if (q.adminId) {
      params.push(q.adminId);
      where.push(`a.admin_id = $${params.length}`);
    }
    if (q.targetId) {
      params.push(q.targetId);
      where.push(`a.target_id = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await ctx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM admin_audit_log a ${clause}`, params);
    const { rows } = await ctx.pool.query(
      `SELECT a.id, a.admin_id AS "adminId", u.username AS "adminUsername", a.counterpart_admin_id AS "counterpartAdminId",
              a.action, a.target_type AS "targetType", a.target_id AS "targetId", a.details, a.created_at AS "createdAt"
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.admin_id ${clause}
       ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, (q.page - 1) * q.limit],
    );
    res.json({ data: rows, page: q.page, limit: q.limit, total: Number(total.rows[0]!.n) });
  });

  return router;
}
