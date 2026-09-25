import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { KEYCLOAK_CLIENT_ID, KEYCLOAK_REALM, KEYCLOAK_URL } from './config';

/**
 * Login = OAuth 2.0 Authorization Code flow with PKCE against Keycloak. The password is typed on Keycloak's page,
 * never in this app. We only receive tokens and send the access token to our APIs as a Bearer token.
 */
export const userManager = new UserManager({
  authority: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
  client_id: KEYCLOAK_CLIENT_ID,
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: 'code',
  scope: 'openid profile email',
  // Tab-scoped storage so a page refresh keeps you logged in; closing the tab forgets the tokens.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
});

export interface TokenClaims {
  sub: string;
  preferred_username?: string;
  email?: string;
  exp?: number;
  realm_access?: { roles?: string[] };
}

/** Reads the (already verified-by-the-server) access token payload, for display and UI hints only. */
export function decodeClaims(token: string | undefined): TokenClaims | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part)))) as TokenClaims;
  } catch {
    return null;
  }
}

interface AuthState {
  ready: boolean;
  user: User | null;
  accessToken: string | undefined;
  claims: TokenClaims | null;
  roles: string[];
  isAdmin: boolean;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Forget local tokens (e.g. after the server says the session was revoked). */
  forget: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    userManager
      .getUser()
      .then((u) => setUser(u && !u.expired ? u : null))
      .finally(() => setReady(true));
    const onLoaded = (u: User) => setUser(u);
    const onUnloaded = () => setUser(null);
    const onRenewError = () => void userManager.removeUser();
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);
    userManager.events.addSilentRenewError(onRenewError);
    return () => {
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
      userManager.events.removeSilentRenewError(onRenewError);
    };
  }, []);

  const login = useCallback(async (returnTo?: string) => {
    await userManager.signinRedirect({ state: { returnTo: returnTo ?? window.location.pathname + window.location.search } });
  }, []);

  const logout = useCallback(async () => {
    const idToken = user?.id_token;
    await userManager.removeUser();
    await userManager.signoutRedirect({ id_token_hint: idToken });
  }, [user]);

  const forget = useCallback(async () => {
    await userManager.removeUser();
  }, []);

  const value = useMemo<AuthState>(() => {
    const claims = decodeClaims(user?.access_token);
    const roles = (claims?.realm_access?.roles ?? []).filter((r) => r === 'user' || r === 'admin');
    return { ready, user, accessToken: user?.access_token, claims, roles, isAdmin: roles.includes('admin'), login, logout, forget };
  }, [ready, user, login, logout, forget]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
