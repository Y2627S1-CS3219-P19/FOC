import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, useApi, type Page } from './api';
import { useAuth } from './auth';
import type { AdminUser } from './types';

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

/** One message for any FAQ unavailability. The cause stays in logs and /health/ready. */
export function FaqUnavailable({ email }: { email?: string }) {
  return (
    <div className="alert alert-error" role="status">
      <div>The FAQ service is currently unavailable. Please try again in a few minutes.</div>
      {email && <div className="small muted">Other pages keep working normally.</div>}
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

/** Inline user search that returns an AdminUser when one is picked. */
export function UserPicker({ label, selected, onSelect }: { label: string; selected: AdminUser | null; onSelect: (u: AdminUser | null) => void }) {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      const q = new URLSearchParams({ search: query.trim(), limit: '6' });
      api<Page<AdminUser>>('GET', `/v1/admin/users?${q}`).then((r) => setResults(r.data), () => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [api, query]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (selected) {
    return (
      <div className="stack-tight">
        <span className="eyebrow">{label}</span>
        <div className="row">
          <span><b>{selected.username}</b> <span className="muted">{selected.email}</span></span>
          <button type="button" className="ghost" onClick={() => { onSelect(null); setQuery(''); }}>Change</button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label>
        {label}
        <input
          placeholder="Search by username, email or name"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </label>
      {open && results.length > 0 && (
        <div className="card" style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
          {results.map((u) => (
            <button
              type="button"
              key={u.id}
              className="ghost"
              style={{ width: '100%', justifyContent: 'flex-start', padding: '10px 14px', borderRadius: 0, borderBottom: '1px solid var(--border)' }}
              onClick={() => { onSelect(u); setOpen(false); setQuery(''); }}
            >
              <b>{u.username}</b>&nbsp;<span className="muted">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
