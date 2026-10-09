import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { ErrorBox, Pagination } from '../components';
import { dayAndTime, shortId, useWallet, type LedgerRow } from '../errands';

const TYPE_LABEL: Record<LedgerRow['type'], string> = {
  ISSUANCE: 'Welcome allocation',
  RESERVE: 'Reserved for an errand',
  SETTLE_DEBIT: 'Paid to courier',
  SETTLE_CREDIT: 'Earned from an errand',
  RELEASE: 'Returned · cancelled or expired',
  ADJUSTMENT: 'Adjustment by an admin',
};

const FILTERS: Array<[LedgerRow['type'] | '', string]> = [
  ['', 'All'],
  ['RESERVE', 'Reserved'],
  ['SETTLE_DEBIT', 'Paid'],
  ['SETTLE_CREDIT', 'Earned'],
  ['RELEASE', 'Returned'],
];

const LIMIT = 20;

interface History {
  data: LedgerRow[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

/** The caller's closed-economy wallet and every credit movement. */
export function CreditsPage() {
  const api = useApi();
  const { wallet } = useWallet();
  const [type, setType] = useState<LedgerRow['type'] | ''>('');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<History | null>(null);
  const [orderOf, setOrderOf] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT), ...(type && { type }) });
    api<History>('GET', `/v1/credits/history?${q}`).then(setHistory, setError);
  }, [api, type, page]);

  // Ledger rows point at reservations; the caller's own reservations tell us which errand each was for.
  useEffect(() => {
    api<{ data: Array<{ id: string; order_id: string }> }>('GET', '/v1/credits/reservations?limit=100').then(
      (r) => setOrderOf(Object.fromEntries(r.data.map((x) => [x.id, x.order_id]))),
      () => undefined,
    );
  }, [api]);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Credits</h1>
        <span className="badge">Closed economy</span>
      </div>
      <ErrorBox error={error} />

      <div className="grid-2">
        <div className="card stack">
          <span className="eyebrow">Available · spendable</span>
          <span className="credits-big">{wallet?.availableBalance ?? '—'}</span>
          <span className="muted">+ {wallet?.reservedBalance ?? 0} held for your open errands</span>
        </div>
        <div className="card soft stack">
          <span className="eyebrow">Total in your wallet</span>
          <span className="credits-mid">{wallet?.totalBalance ?? '—'}</span>
          <span className="small muted">
            Every row below is a movement inside the platform. Credits are never bought, sold or withdrawn: the total in circulation only
            changes when a new student joins.
          </span>
        </div>
      </div>

      <div className="row between">
        <h2>Activity</h2>
        <div className="chips">
          {FILTERS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={type === v}
              onClick={() => {
                setType(v);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {history && history.data.length === 0 && <p className="muted">No credit movements yet.</p>}
      {history && history.data.length > 0 && (
        <table className="responsive">
          <thead>
            <tr>
              <th>When</th>
              <th>Movement</th>
              <th>Errand</th>
              <th className="num">Credits</th>
              <th className="num">Available after</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((row) => {
              const orderId = row.reservation_id ? orderOf[row.reservation_id] : undefined;
              return (
                <tr key={row.id}>
                  <td data-label="When">{dayAndTime(row.created_at)}</td>
                  <td data-label="Movement">{TYPE_LABEL[row.type] ?? row.type}</td>
                  <td data-label="Errand">{orderId ? <Link to={`/errands/${orderId}`}>{shortId(orderId)}</Link> : '—'}</td>
                  <td data-label="Credits" className={`num ${row.amount >= 0 ? 'plus' : 'minus'}`}>
                    {row.amount > 0 ? `+${row.amount}` : row.amount < 0 ? `−${Math.abs(row.amount)}` : '0'}
                  </td>
                  <td data-label="Available after" className="num">
                    {row.balance_after}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {history && history.pagination.totalItems > LIMIT && (
        <Pagination page={history.pagination.page} limit={history.pagination.limit} total={history.pagination.totalItems} onPage={setPage} />
      )}
    </div>
  );
}
