import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type Page } from '../api';
import { ErrorBox, Pagination, UserPicker } from '../components';
import { dayAndTime, shortId, STATUS_LABEL, statusBadgeClass, type Order, type OrderStatus } from '../errands';
import type { AdminUser } from '../types';

const LIMIT = 20;

/** Every order on the platform, newest first. Loads one page per request. */
export function AdminOrdersPage() {
  const api = useApi();
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Order> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setError(null);
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) q.set('status', status);
    if (user) q.set('userId', user.id);
    api<Page<Order>>('GET', `/v1/admin/orders?${q}`).then(setResult, setError);
  }, [api, page, status, user]);

  return (
    <div className="stack">
      <h1>Admin: orders</h1>
      <div className="filters card">
        <select value={status} onChange={(e) => (setPage(1), setStatus(e.target.value as OrderStatus | ''))} aria-label="Status">
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <UserPicker label="Requester or courier" selected={user} onSelect={(u) => (setPage(1), setUser(u))} />
      </div>
      <ErrorBox error={error} />
      {!result && !error && <p className="muted">Loading…</p>}
      {result && result.data.length === 0 && <p className="muted">No orders match these filters.</p>}
      {result && result.data.length > 0 && (
        <>
          <table className="responsive">
            <thead>
              <tr>
                <th>Order</th>
                <th>Created</th>
                <th>Status</th>
                <th>Supplier</th>
                <th>Deliver to</th>
                <th className="num">Credits</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((o) => (
                <tr key={o.id}>
                  <td data-label="Order">
                    <Link to={`/errands/${o.id}`}>{shortId(o.id)}</Link>
                  </td>
                  <td data-label="Created">{dayAndTime(o.createdAt)}</td>
                  <td data-label="Status">
                    <span className={statusBadgeClass(o.status)}>{o.status}</span>
                  </td>
                  <td data-label="Supplier">{o.supplier.name}</td>
                  <td data-label="Deliver to">{o.deliveryLocation}</td>
                  <td data-label="Credits" className="num">
                    {o.creditAmount}
                  </td>
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
