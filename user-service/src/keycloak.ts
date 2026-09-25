import type { Logger } from 'pino';
import { AppError, conflict, unprocessable } from '@foc/shared-middleware';

export interface KeycloakAdminConfig {
  internalUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

export interface CreateKeycloakUser {
  username: string;
  email: string;
  password: string;
  temporaryPassword: boolean;
  emailVerified: boolean;
  requiredActions: string[];
}

export interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  enabled: boolean;
}

const idpError = (message: string) => new AppError(502, 'IDENTITY_PROVIDER_ERROR', message);

/**
 * Thin client for the Keycloak Admin REST API, authenticated as the `user-service` client's service account.
 * The User Service is the ONLY component with credentials that can create users or change roles.
 */
export class KeycloakAdmin {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: KeycloakAdminConfig,
    private readonly logger: Logger,
  ) {}

  private get realmUrl() {
    return `${this.cfg.internalUrl}/realms/${this.cfg.realm}`;
  }

  private get adminUrl() {
    return `${this.cfg.internalUrl}/admin/realms/${this.cfg.realm}`;
  }

  private async serviceToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now() + 15_000) return this.token.value;
    const res = await fetch(`${this.realmUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((err: Error) => {
      throw idpError(`Cannot reach Keycloak: ${err.message}`);
    });
    if (!res.ok) throw idpError(`Keycloak rejected the service credentials (${res.status}).`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Response> {
    const url = new URL(`${this.adminUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const send = async (token: string) =>
      fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      }).catch((err: Error) => {
        throw idpError(`Cannot reach Keycloak: ${err.message}`);
      });
    let res = await send(await this.serviceToken());
    if (res.status === 401) res = await send(await this.serviceToken(true));
    return res;
  }

  private async fail(res: Response, action: string): Promise<never> {
    const text = await res.text().catch(() => '');
    this.logger.error({ status: res.status, body: text.slice(0, 500), action }, 'Keycloak admin call failed');
    throw idpError(`Identity provider error while trying to ${action}.`);
  }

  /** Readiness probe: can we authenticate as the service account? */
  async ping(): Promise<boolean> {
    try {
      await this.serviceToken();
      return true;
    } catch {
      return false;
    }
  }

  async createUser(input: CreateKeycloakUser): Promise<string> {
    const res = await this.request('POST', '/users', {
      username: input.username,
      email: input.email,
      enabled: true,
      emailVerified: input.emailVerified,
      requiredActions: input.requiredActions,
      credentials: [{ type: 'password', value: input.password, temporary: input.temporaryPassword }],
    });
    if (res.status === 201) {
      const location = res.headers.get('location') ?? '';
      const id = location.split('/').pop();
      if (!id) throw idpError('Keycloak did not return the new user id.');
      return id;
    }
    const body = (await res.json().catch(() => ({}))) as {
      errorMessage?: string;
      error?: string;
      error_description?: string;
      field?: string;
      errors?: { field?: string; errorMessage?: string }[];
    };
    if (res.status === 409) {
      const message = body.errorMessage ?? '';
      if (/email/i.test(message)) {
        throw conflict('EMAIL_TAKEN', 'An account with that email already exists.', {
          fieldErrors: { email: 'Email is already registered.' },
        });
      }
      throw conflict('USERNAME_TAKEN', 'That username is already taken.', {
        fieldErrors: { username: 'Username is already taken.' },
      });
    }
    if (res.status === 400) {
      // Password policy: { error: "invalidPassword...", error_description }; user profile: { field, errorMessage }
      if (body.error_description) {
        throw unprocessable('Password does not meet the password policy.', {
          password: body.error_description.replace(/^Invalid password:\s*/i, ''),
        });
      }
      const fieldErrors: Record<string, string> = {};
      for (const e of body.errors ?? [body]) if (e.field) fieldErrors[e.field] = e.errorMessage ?? 'Invalid value.';
      throw unprocessable('Some fields are invalid.', Object.keys(fieldErrors).length ? fieldErrors : { _root: 'Invalid user details.' });
    }
    return this.fail(res, 'create the account');
  }

  async deleteUser(id: string): Promise<void> {
    const res = await this.request('DELETE', `/users/${id}`);
    if (!res.ok && res.status !== 404) await this.fail(res, 'delete the account');
  }

  async findUserByEmail(email: string): Promise<KeycloakUser | null> {
    const res = await this.request('GET', '/users', undefined, { email, exact: 'true' });
    if (!res.ok) await this.fail(res, 'look up the account');
    const users = (await res.json()) as KeycloakUser[];
    return users[0] ?? null;
  }

  async getUser(id: string): Promise<KeycloakUser | null> {
    const res = await this.request('GET', `/users/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, 'load the account');
    return (await res.json()) as KeycloakUser;
  }

  /** Emails the "Verify email" link (single use, valid for `lifespanSeconds`, F1.3.1). */
  async sendVerifyEmail(id: string, options: { lifespanSeconds: number; clientId: string; redirectUri: string }): Promise<void> {
    const res = await this.request('PUT', `/users/${id}/send-verify-email`, undefined, {
      lifespan: String(options.lifespanSeconds),
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
    });
    if (!res.ok) await this.fail(res, 'send the verification email');
  }

  private async realmRole(name: string): Promise<{ id: string; name: string }> {
    const res = await this.request('GET', `/roles/${encodeURIComponent(name)}`);
    if (!res.ok) await this.fail(res, `load the ${name} role`);
    return (await res.json()) as { id: string; name: string };
  }

  /** Adds or removes a realm role for a user. */
  async setRealmRole(userId: string, roleName: string, granted: boolean): Promise<void> {
    const role = await this.realmRole(roleName);
    const res = await this.request(granted ? 'POST' : 'DELETE', `/users/${userId}/role-mappings/realm`, [role]);
    if (!res.ok) await this.fail(res, `${granted ? 'grant' : 'remove'} the ${roleName} role`);
  }

  /** Ends every Keycloak session of the user, so existing tokens stop working (introspection -> inactive). */
  async logoutUser(userId: string): Promise<void> {
    const res = await this.request('POST', `/users/${userId}/logout`);
    if (!res.ok && res.status !== 404) await this.fail(res, 'end the user sessions');
  }

  /** RFC 7662 token introspection: false once the session was ended (logout, newer login, suspension). */
  async introspect(token: string): Promise<boolean> {
    const res = await fetch(`${this.realmUrl}/protocol/openid-connect/token/introspect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5_000),
    }).catch((err: Error) => {
      throw new AppError(503, 'AUTH_SERVICE_UNAVAILABLE', `Cannot verify your session right now (${err.message}).`);
    });
    if (!res.ok) throw new AppError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Cannot verify your session right now.');
    const body = (await res.json()) as { active?: boolean };
    return body.active === true;
  }
}
