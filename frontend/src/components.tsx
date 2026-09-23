import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { useAuth } from './auth';

/** Shows an API error the way the server describes it (code + message). */
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError) {
    const suspended = error.code === 'ACCOUNT_SUSPENDED';
    return (
      <div className="alert alert-error" role="alert">
        <strong>
          {error.status} {error.code}
        </strong>
        <div>{error.message}</div>
        {suspended && error.details?.adminContact ? <div>Contact: {String(error.details.adminContact)}</div> : null}
      </div>
    );
  }
  return (
    <div className="alert alert-error" role="alert">
      {(error as Error).message ?? String(error)}
    </div>
  );
}

export function FieldError({ error, field }: { error: unknown; field: string }) {
  if (!(error instanceof ApiError)) return null;
  const msg = error.fieldErrors[field];
  return msg ? <div className="field-error">{msg}</div> : null;
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {pages} ({total} total)
      </span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

/** Client-side guard for nicer UX only. The server enforces every rule regardless of what the UI shows. */
export function RequireLogin({ children }: { children: ReactNode }) {
  const { ready, user, login } = useAuth();
  if (!ready) return <p>Loading...</p>;
  if (!user)
    return (
      <div className="card">
        <p>You need to log in to see this page.</p>
        <button className="primary" onClick={() => login()}>
          Log in
        </button>
      </div>
    );
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return (
    <RequireLogin>
      {isAdmin ? (
        children
      ) : (
        <div className="alert alert-error">This page is for administrators. (The server would answer 403 anyway.)</div>
      )}
    </RequireLogin>
  );
}

/** Two-step button for destructive actions, instead of a browser confirm() popup. */
export function ConfirmButton({ label, confirmLabel = 'Yes, do it', onConfirm, className = '' }: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm">
      <button
        className="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}

/** Small dev panel: who am I according to the token, and when does it expire. Handy for the D2 demo. */
export function DebugStrip() {
  const { user, claims, roles } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!user) return <div className="debug">Not logged in</div>;
  const left = claims?.exp ? Math.max(0, Math.round(claims.exp - now / 1000)) : 0;
  return (
    <div className="debug">
      <span>
        <b>{claims?.preferred_username}</b> roles: [{roles.join(', ')}] | access token expires in {Math.floor(left / 60)}m {left % 60}s
        (auto-renews)
      </span>
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'show'} token claims
      </button>
      {open && <pre>{JSON.stringify(claims, null, 2)}</pre>}
    </div>
  );
}
