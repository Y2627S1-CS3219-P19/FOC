import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAdminBootstrap } from '../src/bootstrap.js';
import type { AppContext } from '../src/context.js';
import { app, bearer, cleanup, createTestContext, makeUser, passwordToken, PASSWORD, resetDatabase, rootEnv, track, uniq } from './helpers.js';

let ctx: AppContext;
let api: ReturnType<typeof app>;

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx);
  api = app(ctx);
});

afterAll(async () => {
  await cleanup(ctx);
});

describe('Sign-up (F1)', () => {
  const valid = () => {
    const username = uniq('reg');
    return { username, email: `${username}@u.nus.edu`, password: PASSWORD, confirmPassword: PASSWORD };
  };

  it('rejects non-NUS emails, weak passwords and a self-assigned role with per-field 422 errors', async () => {
    const res = await request(api)
      .post('/v1/auth/register')
      .send({ ...valid(), email: 'someone@gmail.com', password: 'weakpass', confirmPassword: 'weakpass', role: 'admin' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['email', 'password', 'role']);
  });

  it('rejects mismatched password confirmation', async () => {
    const res = await request(api).post('/v1/auth/register').send({ ...valid(), confirmPassword: 'Password2' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.confirmPassword).toMatch(/do not match/);
  });

  it('only accepts @u.nus.edu (not @nus.edu.sg)', async () => {
    const res = await request(api).post('/v1/auth/register').send({ ...valid(), email: 'staff@nus.edu.sg' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fieldErrors.email).toMatch(/u\.nus\.edu/);
  });

  it('creates a user-role account that must verify its email, and queues UserRegistered', async () => {
    const body = valid();
    const res = await request(api).post('/v1/auth/register').send(body);
    expect(res.status).toBe(201);
    track(res.body.data.user.id);
    expect(res.body.data.user.role).toBe('user');
    expect(res.body.data.nextStep).toBe('VERIFY_EMAIL');

    const kcUser = (await ctx.kc.getUser(res.body.data.user.id)) as { emailVerified: boolean; requiredActions?: string[] };
    expect(kcUser.emailVerified).toBe(false);
    expect(kcUser.requiredActions).toContain('VERIFY_EMAIL');

    const { rows } = await ctx.pool.query(`SELECT event_type, envelope FROM outbox_events WHERE envelope->'payload'->>'userId' = $1`, [
      res.body.data.user.id,
    ]);
    expect(rows.map((r) => r.event_type)).toEqual(['UserRegistered']);
  });

  it('NFR5.1: 100 concurrent sign-ups with the same username -> exactly one account', async () => {
    const username = uniq('race');
    const attempts = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        request(api)
          .post('/v1/auth/register')
          .send({ username, email: `${username}_${i}@u.nus.edu`, password: PASSWORD, confirmPassword: PASSWORD }),
      ),
    );
    const created = attempts.filter((r) => r.status === 201);
    created.forEach((r) => track(r.body.data.user.id));
    expect(created).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 409).length).toBe(99);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [username]);
    expect(rows[0].n).toBe(1);
  });
});

describe('Authentication and RBAC (F6)', () => {
  it('401 without a token, 401 with a garbage token', async () => {
    expect((await request(api).get('/v1/users/me')).body.error.code).toBe('TOKEN_MISSING');
    const res = await request(api).get('/v1/users/me').set(bearer('not.a.jwt'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('a regular user gets 403 on admin routes; an admin gets 200 (401 vs 403, F6.6)', async () => {
    const user = await makeUser(ctx);
    const admin = await makeUser(ctx, 'admin');
    const denied = await request(api).get('/v1/admin/users').set(bearer(user.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');
    const allowed = await request(api).get('/v1/admin/users').set(bearer(admin.token));
    expect(allowed.status).toBe(200);
    expect(allowed.body.total).toBeGreaterThanOrEqual(2);
  });
});

describe('Profile (F3, F4.1, D2 Part 1 #5)', () => {
  it('lets the owner update whitelisted fields only', async () => {
    const user = await makeUser(ctx);
    const ok = await request(api)
      .patch('/v1/users/me')
      .set(bearer(user.token))
      .send({ displayName: 'Alice', contactNumber: '+65 9123 4567', defaultDeliveryLocation: 'PGP House 7' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ displayName: 'Alice', contactNumber: '+65 9123 4567', defaultDeliveryLocation: 'PGP House 7' });

    for (const forbiddenBody of [{ role: 'admin' }, { status: 'active' }, { id: user.id }, { email: 'x@u.nus.edu' }, { rating: 5 }]) {
      const res = await request(api).patch('/v1/users/me').set(bearer(user.token)).send(forbiddenBody);
      expect(res.status).toBe(422);
      expect(Object.values(res.body.error.details.fieldErrors)).toContain('This field is not allowed.');
    }
    const me = await request(api).get('/v1/users/me').set(bearer(user.token));
    expect(me.body.data.role).toBe('user');
  });
});

describe('Internal endpoints (F3.2, F6.4)', () => {
  it('need the service secret, reject user tokens, and expose no PII', async () => {
    const user = await makeUser(ctx);
    const path = `/v1/internal/users/${user.id}/summary`;
    expect((await request(api).get(path)).status).toBe(401);
    const withUserToken = await request(api).get(path).set(bearer(user.token));
    expect(withUserToken.status).toBe(403);
    expect(withUserToken.body.error.code).toBe('USER_TOKEN_NOT_ALLOWED');
    const ok = await request(api).get(path).set('X-Internal-Auth', rootEnv.INTERNAL_AUTH_SECRET!);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body.data).sort()).toEqual(['displayName', 'id', 'rating']);
  });
});

describe('Suspension (F30.3-30.4, F4.2.1, F3.1.4)', () => {
  it('ends existing sessions, allows reading the notice, blocks everything else, and can be reversed', async () => {
    const admin = await makeUser(ctx, 'admin');
    const user = await makeUser(ctx);

    const res = await request(api).patch(`/v1/admin/users/${user.id}/suspend`).set(bearer(admin.token)).send({ reason: 'Spam orders' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');

    // Old token: session ended in Keycloak.
    const old = await request(api).get('/v1/users/me').set(bearer(user.token));
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('SESSION_REVOKED');

    // New login still works, profile shows the suspension and admin contact...
    const fresh = await passwordToken(user.username);
    const me = await request(api).get('/v1/users/me').set(bearer(fresh));
    expect(me.status).toBe(200);
    expect(me.body.data.suspension).toMatchObject({ reason: 'Spam orders', adminContact: 'foc-admin@u.nus.edu' });
    // ...but every other action is refused.
    const blocked = await request(api).patch('/v1/users/me').set(bearer(fresh)).send({ displayName: 'x' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    // Other services see it through introspection.
    const intro = await request(api).post('/v1/internal/auth/introspect').set('X-Internal-Auth', rootEnv.INTERNAL_AUTH_SECRET!).send({ token: fresh });
    expect(intro.body.data).toMatchObject({ active: true, status: 'suspended' });

    expect((await request(api).patch(`/v1/admin/users/${admin.id}/suspend`).set(bearer(admin.token)).send({ reason: 'self' })).body.error.code).toBe(
      'CANNOT_SUSPEND_SELF',
    );

    const back = await request(api).patch(`/v1/admin/users/${user.id}/reinstate`).set(bearer(admin.token));
    expect(back.body.data.status).toBe('active');
    expect((await request(api).patch('/v1/users/me').set(bearer(fresh)).send({ displayName: 'Back' })).status).toBe(200);
  });

  it('requires a reason', async () => {
    const admin = await makeUser(ctx, 'admin');
    const user = await makeUser(ctx);
    const res = await request(api).patch(`/v1/admin/users/${user.id}/suspend`).set(bearer(admin.token)).send({});
    expect(res.status).toBe(422);
  });
});

describe('Two-admin role changes (F1.1.8, F29.2, D2 Part 1 #6)', () => {
  it('promotion needs a second, different admin and applies immediately', async () => {
    const a = await makeUser(ctx, 'admin');
    const b = await makeUser(ctx, 'admin');
    const u = await makeUser(ctx);

    const reqRes = await request(api).post('/v1/admin/role-changes').set(bearer(a.token)).send({ targetUserId: u.id, newRole: 'admin' });
    expect(reqRes.status).toBe(201);
    expect(reqRes.body.data.status).toBe('pending');
    const id = reqRes.body.data.id;

    // Nothing changed yet.
    expect((await request(api).get('/v1/admin/users').set(bearer(u.token))).status).toBe(403);
    // Duplicate pending request is refused.
    expect((await request(api).post('/v1/admin/role-changes').set(bearer(b.token)).send({ targetUserId: u.id, newRole: 'admin' })).body.error.code).toBe(
      'REQUEST_PENDING',
    );

    const self = await request(api).post(`/v1/admin/role-changes/${id}/confirm`).set(bearer(a.token));
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('SAME_ADMIN_CANNOT_CONFIRM');

    const ok = await request(api).post(`/v1/admin/role-changes/${id}/confirm`).set(bearer(b.token));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'approved', requestedBy: a.id, decidedBy: b.id });

    // Old token was logged out; new token carries the admin role.
    expect((await request(api).get('/v1/users/me').set(bearer(u.token))).status).toBe(401);
    const promoted = await passwordToken(u.username);
    expect((await request(api).get('/v1/admin/users').set(bearer(promoted))).status).toBe(200);

    const audit = await request(api).get(`/v1/admin/audit/actions?targetId=${u.id}&action=PROMOTE_ADMIN`).set(bearer(promoted));
    expect(audit.body.data[0]).toMatchObject({ adminId: b.id, counterpartAdminId: a.id });
  });

  it('the requester can cancel; confirming a cancelled request is refused', async () => {
    const a = await makeUser(ctx, 'admin');
    const b = await makeUser(ctx, 'admin');
    const u = await makeUser(ctx);
    const { body } = await request(api).post('/v1/admin/role-changes').set(bearer(a.token)).send({ targetUserId: u.id, newRole: 'admin' });
    expect((await request(api).post(`/v1/admin/role-changes/${body.data.id}/reject`).set(bearer(a.token))).body.data.status).toBe('rejected');
    expect((await request(api).post(`/v1/admin/role-changes/${body.data.id}/confirm`).set(bearer(b.token))).body.error.code).toBe(
      'ROLE_CHANGE_NOT_PENDING',
    );
  });

  it('the audit log cannot be modified', async () => {
    await expect(ctx.pool.query(`UPDATE admin_audit_log SET action = 'X'`)).rejects.toThrow(/append-only/);
  });
});

describe('Last-admin protection (D2 edge cases)', () => {
  beforeEach(async () => {
    await resetDatabase(ctx);
  });

  it('the only admin cannot demote themselves; with two, one can, and then the other cannot', async () => {
    const a = await makeUser(ctx, 'admin');
    const solo = await request(api).post('/v1/admin/role-changes').set(bearer(a.token)).send({ targetUserId: a.id, newRole: 'user' });
    expect(solo.status).toBe(409);
    expect(solo.body.error.code).toBe('LAST_ADMIN');

    const b = await makeUser(ctx, 'admin');
    const r = await request(api).post('/v1/admin/role-changes').set(bearer(a.token)).send({ targetUserId: a.id, newRole: 'user' });
    expect(r.status).toBe(201);
    expect((await request(api).post(`/v1/admin/role-changes/${r.body.data.id}/confirm`).set(bearer(b.token))).status).toBe(200);

    const last = await request(api).post('/v1/admin/role-changes').set(bearer(b.token)).send({ targetUserId: b.id, newRole: 'user' });
    expect(last.body.error.code).toBe('LAST_ADMIN');
  });

  it('two demotions confirmed at the same time can never remove the last admin', async () => {
    const a = await makeUser(ctx, 'admin');
    const b = await makeUser(ctx, 'admin');
    const demoteA = await request(api).post('/v1/admin/role-changes').set(bearer(b.token)).send({ targetUserId: a.id, newRole: 'user' });
    const demoteB = await request(api).post('/v1/admin/role-changes').set(bearer(a.token)).send({ targetUserId: b.id, newRole: 'user' });
    const [r1, r2] = await Promise.all([
      request(api).post(`/v1/admin/role-changes/${demoteA.body.data.id}/confirm`).set(bearer(a.token)),
      request(api).post(`/v1/admin/role-changes/${demoteB.body.data.id}/confirm`).set(bearer(b.token)),
    ]);
    // a confirming their own demotion requested by b is allowed (different requester); one must fail.
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect([401, 409]).toContain(statuses[1]);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin'`);
    expect(rows[0].n).toBe(1);
  });
});

describe('First-admin bootstrap (F29.3)', () => {
  beforeEach(async () => {
    await resetDatabase(ctx);
  });

  it('creates exactly one admin even with concurrent starts, then never runs again', async () => {
    const username = uniq('boot');
    const bootCtx = await createTestContext({
      BOOTSTRAP_ADMIN_EMAIL: `${username}@u.nus.edu`,
      BOOTSTRAP_ADMIN_USERNAME: username,
      BOOTSTRAP_ADMIN_TEMP_PASSWORD: 'TempPass1',
    });
    const results = await Promise.all([runAdminBootstrap(bootCtx), runAdminBootstrap(bootCtx)]);
    expect(results.sort()).toEqual(['created', 'skipped-already-completed']);

    const { rows } = await ctx.pool.query('SELECT id, role FROM users');
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('admin');
    track(rows[0].id);

    const kcUser = (await ctx.kc.getUser(rows[0].id)) as { emailVerified: boolean; requiredActions?: string[] };
    expect(kcUser.emailVerified).toBe(true);
    expect(kcUser.requiredActions).toContain('UPDATE_PASSWORD'); // temporary password must be changed

    // Even after that admin is demoted in the DB, a restart does not re-grant anything.
    await ctx.pool.query(`UPDATE users SET role = 'user'`);
    expect(await runAdminBootstrap(bootCtx)).toBe('skipped-already-completed');
    await bootCtx.pool.end();
  });

  it('does nothing when not configured', async () => {
    expect(await runAdminBootstrap(ctx)).toBe('skipped-not-configured');
  });
});
