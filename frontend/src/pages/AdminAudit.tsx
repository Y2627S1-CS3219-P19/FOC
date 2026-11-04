import { useEffect, useState } from 'react';
import { useApi, type Page } from '../api';
import { ErrorBox, Pagination } from '../components';
import { dayAndTime, shortId } from '../errands';
import type { AuditEntry } from '../types';

const ACTION_LABEL: Record<string, string> = {
  SUSPEND_USER: 'Suspended user',
  REINSTATE_USER: 'Reinstated user',
  ROLE_CHANGE_REQUESTED: 'Requested role change',
  PROMOTE_ADMIN: 'Promoted to admin',
  DEMOTE_ADMIN: 'Demoted to user',
  ROLE_CHANGE_REJECTED: 'Rejected role change',
  ROLE_CHANGE_CANCELLED: 'Cancelled role change',
  BOOTSTRAP_ADMIN: 'Startup admin created',
};

/** The parts of `details` worth reading; ids are left out. */
function describe(d: AuditEntry['details']): string {
  if (!d) return '—';
  const parts: string[] = [];
  if (d.fromRole && d.toRole) parts.push(`${d.fromRole} → ${d.toRole}`);
  if (d.reason) parts.push(`Reason: ${d.reason}`);
  return parts.length ? parts.join(' · ') : '—';
}

/** Every admin action recorded by user-service, newest first. */
export function AdminAuditPage() {
  const api = useApi();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<AuditEntry> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setError(null);
    const q = new URLSearchParams({ page: String(page), limit: '20', ...(action && { action }) });
    api<Page<AuditEntry>>('GET', `/v1/admin/audit/actions?${q}`).then(setResult, setError);
  }, [api, page, action]);

  return (
    <div className="stack">
      <h1>Admin: audit log</h1>
      <div className="filters card">
        <select value={action} onChange={(e) => (setPage(1), setAction(e.target.value))} aria-label="Action">
          <option value="">Any action</option>
          {Object.entries(ACTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      {!result && !error && <p className="muted">Loading…</p>}
      {result && result.data.length === 0 && <p className="muted">No admin actions recorded.</p>}
      {result && result.data.length > 0 && (
        <>
          <table className="responsive">
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((a) => (
                <tr key={a.id}>
                  <td data-label="When">{dayAndTime(a.createdAt)}</td>
                  <td data-label="Admin">{a.adminUsername ?? (a.adminId ? shortId(a.adminId) : 'system')}</td>
                  <td data-label="Action">{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td data-label="Target" title={a.targetId}>
                    {a.targetType} {shortId(a.targetId)}
                  </td>
                  <td data-label="Details">{describe(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={result.page} limit={result.limit} total={result.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
