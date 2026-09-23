import pg, { type PoolClient } from 'pg';
import { conflict } from '@foc/shared-middleware';

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 20 });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Advisory lock ids (held for one transaction). */
export const LOCKS = {
  roleChanges: 7_270_101,
  adminBootstrap: 7_270_102,
} as const;

/** Map Postgres unique-violation errors to 409 responses with a field name. */
export function mapUniqueViolation(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return err;
  if (e.constraint === 'users_username_key') {
    return conflict('USERNAME_TAKEN', 'That username is already taken.', { fieldErrors: { username: 'Username is already taken.' } });
  }
  if (e.constraint === 'users_email_key') {
    return conflict('EMAIL_TAKEN', 'An account with that email already exists.', {
      fieldErrors: { email: 'Email is already registered.' },
    });
  }
  if (e.constraint === 'role_change_one_pending_per_user') {
    return conflict('REQUEST_PENDING', 'This user already has a pending role change request.');
  }
  return conflict('DUPLICATE', 'That record already exists.');
}
