import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type Page } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Pagination } from '../components';
import type { AdminUser } from '../types';

function SuspendControl({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function run(action: 'suspend' | 'reinstate') {
    setError(null);
    try {
      await api('PATCH', `/v1/admin/users/${user.id}/${action}`, action === 'suspend' ? { reason } : undefined);
      setOpen(false);
      setReason('');
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  if (user.status === 'suspended') return <button onClick={() => run('reinstate')}>Reinstate</button>;
  return (
    <span className="stack-inline">
      {!open ? (
        <button onClick={() => setOpen(true)}>Suspend</button>
      ) : (
        <span className="confirm">
          <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="danger" onClick={() => run('suspend')}>
            Suspend
          </button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </span>
      )}
      <ErrorBox error={error} />
    </span>
  );
}

function RoleRequestControl({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const api = useApi();
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);
  const newRole = user.role === 'admin' ? 'user' : 'admin';
  async function request() {
    setError(null);
    try {
      await api('POST', '/v1/admin/role-changes', { targetUserId: user.id, newRole });
      setSent(true);
      onDone();
    } catch (err) {
      setError(err);
    }
  }
  return (
    <span className="stack-inline">
      {sent ? (
        <span className="muted">
          Requested. <Link to="/admin/role-changes">Another admin must confirm.</Link>
        </span>
      ) : (
        <button onClick={request}>{newRole === 'admin' ? 'Request promotion to admin' : 'Request demotion to user'}</button>
      )}
      <ErrorBox error={error} />
    </span>
  );
}

export function AdminUsersPage() {
  const api = useApi();
  const { claims } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<AdminUser> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (role) q.set('role', role);
    api<Page<AdminUser>>('GET', `/v1/admin/users?${q}`).then(setResult, setError);
  }, [api, page, search, status, role]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="stack">
      <h1>Admin: users</h1>
      <div className="filters card">
        <input placeholder="Search username, email or name" value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
        <select value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={role} onChange={(e) => (setPage(1), setRole(e.target.value))} aria-label="Role">
          <option value="">Any role</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <ErrorBox error={error} />
      {result && (
        <>
          <table className="responsive">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((u) => {
                const isMe = u.id === claims?.sub;
                return (
                  <tr key={u.id}>
                    <td data-label="User">
                      <b>{u.username}</b> {isMe && <span className="badge">you</span>}
                      <div className="muted">{u.email}</div>
                    </td>
                    <td data-label="Role">{u.role}</td>
                    <td data-label="Status">
                      {u.status}
                      {u.suspensionReason && <div className="muted">Reason: {u.suspensionReason}</div>}
                    </td>
                    <td data-label="Actions" className="actions">
                      {!isMe && u.role === 'user' && <SuspendControl user={u} onDone={load} />}
                      <RoleRequestControl user={u} onDone={load} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={result.page} limit={result.limit} total={result.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
