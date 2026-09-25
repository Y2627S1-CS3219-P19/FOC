import { addOutboxEvent, USER_EVENTS } from '@foc/shared-events';
import type { AppContext } from './context.js';
import { mapUniqueViolation, withTransaction } from './db.js';
import { insertUser, writeAudit, type AuditEntry, type Role, type UserRow } from './users.js';

export interface ProvisionInput {
  username: string;
  email: string;
  password: string;
  role: Role;
  /** Temporary passwords must be changed at first login (Keycloak UPDATE_PASSWORD required action). */
  temporaryPassword: boolean;
  emailVerified: boolean;
  sendVerificationEmail: boolean;
  correlationId?: string | null;
  audit?: Omit<AuditEntry, 'targetId' | 'targetType'>;
}

/**
 * The ONE way an account is created - used by sign-up and by the first-admin bootstrap, so both get the
 * same invariants: Keycloak user (password hashed there), users row, UserRegistered event (via outbox).
 * If the database step fails, the Keycloak user is deleted again (compensation), so no half-created accounts.
 */
export async function provisionUser(ctx: AppContext, input: ProvisionInput): Promise<UserRow> {
  const requiredActions = [
    ...(input.emailVerified ? [] : ['VERIFY_EMAIL']),
    ...(input.temporaryPassword ? ['UPDATE_PASSWORD'] : []),
  ];
  const keycloakId = await ctx.kc.createUser({
    username: input.username,
    email: input.email,
    password: input.password,
    temporaryPassword: input.temporaryPassword,
    emailVerified: input.emailVerified,
    requiredActions,
  });

  let user: UserRow;
  try {
    if (input.role === 'admin') await ctx.kc.setRealmRole(keycloakId, 'admin', true);
    user = await withTransaction(ctx.pool, async (db) => {
      const row = await insertUser(db, {
        id: keycloakId,
        username: input.username,
        email: input.email,
        displayName: input.username,
        role: input.role,
      });
      await addOutboxEvent(
        db,
        USER_EVENTS.registered,
        { userId: row.id, username: row.username, role: row.role, registeredAt: row.created_at.toISOString() },
        input.correlationId,
      );
      if (input.audit) await writeAudit(db, { ...input.audit, targetType: 'user', targetId: row.id });
      return row;
    });
  } catch (err) {
    await ctx.kc.deleteUser(keycloakId).catch((e) => ctx.logger.error({ err: e, keycloakId }, 'Compensation failed: orphan Keycloak user'));
    throw mapUniqueViolation(err);
  }

  if (input.sendVerificationEmail) {
    await ctx.kc
      .sendVerifyEmail(user.id, {
        lifespanSeconds: ctx.config.verifyEmailLifespanSeconds,
        clientId: ctx.config.spaClientId,
        redirectUri: `${ctx.config.spaUrl}/`,
      })
      .catch((err) => ctx.logger.warn({ err, userId: user.id }, 'Could not send verification email; user can resend from the login page'));
  }
  return user;
}
