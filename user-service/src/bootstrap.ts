import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { LOCKS, withTransaction } from './db.js';
import { provisionUser } from './provisioning.js';
import { findUserById, insertUser, writeAudit } from './users.js';

// One permanent flag per slot, so an environment that already made admin #1 still makes admin #2.
const FLAGS = ['admin_bootstrap_completed', 'admin_bootstrap_2_completed'];

export type BootstrapResult = 'skipped-not-configured' | 'skipped-already-completed' | 'created' | 'adopted-existing';

/**
 * Creates the first two FoC admins on startup (F29.3, "bootstrapping" from the course notes). Two, because the
 * two-admin role-change workflow needs a second admin to confirm anything. Returns one result per slot.
 * - Each slot only runs when its BOOTSTRAP_ADMIN[_2]_EMAIL + _TEMP_PASSWORD are set (operator-controlled, no public endpoint).
 * - Reuses provisionUser(), the same code path as sign-up, so all invariants/side effects apply.
 * - A permanent flag per slot in system_state means it never runs again - even if every admin is later demoted,
 *   so it can never silently re-grant revoked privileges. Recovery is an operator task, not an HTTP route.
 * - A Postgres advisory lock + the flag make concurrent starts (two containers) safe: only one creates the admin.
 * - The password is temporary: Keycloak forces a change at first login (UPDATE_PASSWORD).
 */
export async function runAdminBootstrap(ctx: AppContext): Promise<BootstrapResult[]> {
  const results: BootstrapResult[] = [];
  for (const [i, admin] of ctx.config.bootstrapAdmins.entries()) results.push(await bootstrapAdmin(ctx, admin, FLAGS[i]!));
  return results;
}

async function bootstrapAdmin(ctx: AppContext, admin: Config['bootstrapAdmins'][number], flag: string): Promise<BootstrapResult> {
  const { email, username, tempPassword } = admin;
  if (!email || !tempPassword) {
    ctx.logger.info({ flag }, 'Admin bootstrap not configured; skipping');
    return 'skipped-not-configured';
  }

  const lock = await ctx.pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [LOCKS.adminBootstrap]);
    const { rows } = await lock.query<{ value: string }>('SELECT value FROM system_state WHERE key = $1', [flag]);
    if (rows[0]?.value === 'true') {
      ctx.logger.info({ flag }, 'Admin bootstrap already completed; nothing to do');
      return 'skipped-already-completed';
    }

    let result: BootstrapResult;
    // A previous run may have created the Keycloak user and then crashed before setting the flag.
    const existing = await ctx.kc.findUserByEmail(email);
    if (existing) {
      await ctx.kc.setRealmRole(existing.id, 'admin', true);
      await withTransaction(ctx.pool, async (db) => {
        const row = await findUserById(db, existing.id, true);
        if (!row) {
          await insertUser(db, { id: existing.id, username: existing.username, email, displayName: existing.username, role: 'admin' });
        } else {
          await db.query(`UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1`, [existing.id]);
        }
        await writeAudit(db, {
          adminId: null,
          action: 'BOOTSTRAP_ADMIN',
          targetType: 'user',
          targetId: existing.id,
          details: { actor: 'system-bootstrap', adoptedExisting: true },
        });
      });
      result = 'adopted-existing';
    } else {
      await provisionUser(ctx, {
        username,
        email,
        password: tempPassword,
        role: 'admin',
        temporaryPassword: true,
        emailVerified: true,
        sendVerificationEmail: false,
        audit: { adminId: null, action: 'BOOTSTRAP_ADMIN', details: { actor: 'system-bootstrap' } },
      });
      result = 'created';
    }

    await lock.query(
      `INSERT INTO system_state (key, value) VALUES ($1, 'true')
       ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
      [flag],
    );
    ctx.logger.info({ email, result }, 'Admin bootstrapped. Remove its BOOTSTRAP_ADMIN* values from the environment.');
    return result;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [LOCKS.adminBootstrap]).catch(() => undefined);
    lock.release();
  }
}

/** Keycloak may still be warming up; retry a few times without blocking the API forever. */
export async function runAdminBootstrapWithRetry(ctx: AppContext, attempts = 10, delayMs = 3_000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await runAdminBootstrap(ctx);
      return;
    } catch (err) {
      ctx.logger.warn({ err, attempt: i }, 'Admin bootstrap attempt failed');
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  ctx.logger.error('Admin bootstrap gave up; fix the error above and restart the user-service');
}
