import type { PoolClient } from 'pg';
import type { Pool } from './db.js';

type Queryable = Pool | PoolClient;

export type Role = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  display_name: string;
  contact_number: string | null;
  default_delivery_location: string | null;
  role: Role;
  status: AccountStatus;
  suspension_reason: string | null;
  suspended_at: Date | null;
  suspended_by: string | null;
  rating_sum: number;
  rating_count: number;
  created_at: Date;
  updated_at: Date;
}

export const rating = (u: Pick<UserRow, 'rating_sum' | 'rating_count'>) =>
  u.rating_count > 0 ? Math.round((u.rating_sum / u.rating_count) * 100) / 100 : null;

/** What the account owner sees about themselves (F3.1). */
export function toProfile(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    contactNumber: u.contact_number,
    defaultDeliveryLocation: u.default_delivery_location,
    role: u.role,
    status: u.status,
    rating: rating(u),
    createdAt: u.created_at,
  };
}

/** What admins see in user management (F30). */
export function toAdminView(u: UserRow) {
  return {
    ...toProfile(u),
    suspensionReason: u.suspension_reason,
    suspendedAt: u.suspended_at,
    suspendedBy: u.suspended_by,
    updatedAt: u.updated_at,
  };
}

/** Internal summary for other services: no email, phone, location or credentials (F3.2). */
export function toSummary(u: UserRow) {
  return { id: u.id, displayName: u.display_name, rating: rating(u) };
}

export async function findUserById(db: Queryable, id: string, forUpdate = false): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function insertUser(
  db: Queryable,
  u: { id: string; username: string; email: string; displayName: string; role: Role },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (id, username, email, display_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [u.id, u.username, u.email, u.displayName, u.role],
  );
  return rows[0]!;
}

export async function countActiveAdmins(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`);
  return Number(rows[0]!.n);
}

export interface AuditEntry {
  adminId: string | null;
  counterpartAdminId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only admin audit trail (NFR18.2). A DB trigger rejects UPDATE/DELETE. */
export async function writeAudit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log (admin_id, counterpart_admin_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.adminId,
      entry.counterpartAdminId ?? null,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
    ],
  );
}
