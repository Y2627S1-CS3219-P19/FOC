import { useCallback, useEffect, useState } from 'react';
import { useApi, type Page } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Pagination } from '../components';
import type { RoleChange } from '../types';

export function AdminRoleChangesPage() {
  const api = useApi();
  const { claims } = useAuth();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<RoleChange> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ page: String(page), limit: '20' });
    if (status) q.set('status', status);
    api<Page<RoleChange>>('GET', `/v1/admin/role-changes?${q}`).then(setResult, setError);
  }, [api, page, status]);
  useEffect(load, [load]);

  async function decide(id: string, action: 'confirm' | 'reject') {
    setError(null);
    try {
      await api('POST', `/v1/admin/role-changes/${id}/${action}`);
      load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack">
      <h1>Admin: role changes</h1>
      <p className="muted">
        Promotions and demotions need two administrators: one requests (on the Users page), a different one confirms here. The
        server refuses a confirmation from the requester and any change that would leave no administrator.
      </p>
      <div className="filters card">
        <select value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))} aria-label="Status">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <ErrorBox error={error} />
      {result && (
        <>
          {result.data.length === 0 && <p className="muted">Nothing here.</p>}
          <table className="responsive">
            <thead>
              <tr>
                <th>User</th>
                <th>Change</th>
                <th>Requested by</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((r) => {
                const mine = r.requestedBy === claims?.sub;
                return (
                  <tr key={r.id}>
                    <td data-label="User">{r.targetUsername}</td>
                    <td data-label="Change">
                      {r.fromRole} → <b>{r.toRole}</b>
                    </td>
                    <td data-label="Requested by">
                      {r.requestedByUsername} {mine && <span className="badge">you</span>}
                    </td>
                    <td data-label="Status">
                      {r.status}
                      {r.decidedByUsername && <div className="muted">by {r.decidedByUsername}</div>}
                    </td>
                    <td data-label="Actions" className="actions">
                      {r.status === 'pending' && (
                        <>
                          <button
                            className="primary"
                            disabled={mine}
                            title={mine ? 'A different administrator must confirm your request' : ''}
                            onClick={() => decide(r.id, 'confirm')}
                          >
                            Confirm
                          </button>
                          <button onClick={() => decide(r.id, 'reject')}>{mine ? 'Cancel request' : 'Reject'}</button>
                          {mine && <div className="muted">Waiting for another admin</div>}
                        </>
                      )}
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
