import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, type Page } from '../api';
import { ErrorBox, Pagination } from '../components';
import { dayAndTime, type LedgerRow } from '../errands';
import type { AdminUser } from '../types';

const TYPE_LABEL: Record<LedgerRow['type'], string> = {
  ISSUANCE: 'Welcome allocation',
  RESERVE: 'Reserved',
  SETTLE_DEBIT: 'Paid',
  SETTLE_CREDIT: 'Earned',
  RELEASE: 'Returned',
  ADJUSTMENT: 'Adjustment',
};

const LIMIT = 20;

interface Summary {
  totalWallets: number;
  totalAvailable: number;
  totalReserved: number;
  totalCredits: number;
}

interface Reconciliation {
  walletTotal: number;
  ledgerTotal: number;
  healthy: boolean;
}

interface History {
  data: LedgerRow[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface AdjustmentResult {
  userId: string;
  amount: number;
  reason: string;
  balanceAfter: number;
}

/** Inline user search that returns an AdminUser when one is picked. */
function UserPicker({ label, selected, onSelect }: { label: string; selected: AdminUser | null; onSelect: (u: AdminUser | null) => void }) {
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

export function AdminCreditsPage() {
  const api = useApi();

  // --- Summary & reconciliation ---
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadOverview = useCallback(() => {
    api<{ data: Summary }>('GET', '/v1/admin/credits/summary').then((r) => setSummary(r.data), setError);
    api<{ data: Reconciliation }>('GET', '/v1/admin/credits/reconciliation').then((r) => setRecon(r.data), setError);
  }, [api]);

  useEffect(loadOverview, [loadOverview]);

  // --- User history lookup ---
  const [lookupUser, setLookupUser] = useState<AdminUser | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);

  const loadHistory = useCallback(() => {
    if (!lookupUser) return;
    setHistoryError(null);
    const q = new URLSearchParams({ page: String(historyPage), limit: String(LIMIT) });
    api<History>('GET', `/v1/admin/credits/users/${lookupUser.id}/history?${q}`).then(setHistory, setHistoryError);
  }, [api, lookupUser, historyPage]);

  useEffect(() => {
    if (lookupUser) loadHistory();
    else { setHistory(null); setHistoryError(null); }
  }, [loadHistory, lookupUser]);

  // --- Balance at ---
  const [balanceAtTs, setBalanceAtTs] = useState('');
  const [balanceAtResult, setBalanceAtResult] = useState<number | null>(null);
  const [balanceAtError, setBalanceAtError] = useState<unknown>(null);

  async function lookupBalanceAt(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupUser || !balanceAtTs) return;
    setBalanceAtError(null);
    setBalanceAtResult(null);
    try {
      const ts = new Date(balanceAtTs).toISOString();
      const res = await api<{ data: { availableBalance: number } }>(
        'GET', `/v1/admin/credits/users/${lookupUser.id}/balance-at?ts=${encodeURIComponent(ts)}`,
      );
      setBalanceAtResult(res.data.availableBalance);
    } catch (err) {
      setBalanceAtError(err);
    }
  }

  // --- Manual adjustment ---
  const [adjUser, setAdjUser] = useState<AdminUser | null>(null);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjResult, setAdjResult] = useState<AdjustmentResult | null>(null);
  const [adjError, setAdjError] = useState<unknown>(null);
  const [adjBusy, setAdjBusy] = useState(false);

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!adjUser) return;
    setAdjError(null);
    setAdjResult(null);
    setAdjBusy(true);
    try {
      const res = await api<{ data: AdjustmentResult }>('POST', '/v1/admin/credits/adjustments', {
        userId: adjUser.id,
        amount: Number(adjAmount),
        reason: adjReason.trim(),
      });
      setAdjResult(res.data);
      setAdjAmount('');
      setAdjReason('');
      loadOverview();
      // Refresh user history if we're looking at the same user
      if (lookupUser && lookupUser.id === adjUser.id) loadHistory();
    } catch (err) {
      setAdjError(err);
    } finally {
      setAdjBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Admin: credits</h1>
      <p className="muted">
        Overview of the closed credit economy. All credits in circulation were created by welcome allocations or manual adjustments.
      </p>
      <ErrorBox error={error} />

      {/* ---- Summary cards ---- */}
      {summary && (
        <div className="grid-2">
          <div className="card stack">
            <span className="eyebrow">Total credits in circulation</span>
            <span className="credits-big">{summary.totalCredits}</span>
            <span className="muted">{summary.totalWallets} wallets</span>
          </div>
          <div className="card soft stack">
            <span className="eyebrow">Breakdown</span>
            <div className="summary-row">
              <span>Available (spendable)</span>
              <b>{summary.totalAvailable}</b>
            </div>
            <div className="summary-row">
              <span>Reserved (held for errands)</span>
              <b>{summary.totalReserved}</b>
            </div>
          </div>
        </div>
      )}

      {/* ---- Reconciliation ---- */}
      {recon && (
        <div className={`alert ${recon.healthy ? 'alert-ok' : 'alert-error'}`}>
          <strong>Reconciliation: {recon.healthy ? 'healthy' : 'mismatch detected'}</strong>
          <div className="muted" style={{ marginTop: 4 }}>
            Wallet total: {recon.walletTotal} &middot; Ledger total: {recon.ledgerTotal}
            {recon.healthy
              ? ' — all credits accounted for.'
              : ` — difference of ${Math.abs(recon.walletTotal - recon.ledgerTotal)}.`}
          </div>
        </div>
      )}

      {/* ---- Manual adjustment ---- */}
      <h2>Manual adjustment</h2>
      <form className="card stack" onSubmit={submitAdjustment}>
        <div className="grid-2">
          <UserPicker label="User" selected={adjUser} onSelect={(u) => { setAdjUser(u); setAdjResult(null); setAdjError(null); }} />
          <label>
            Amount
            <input
              required
              type="number"
              placeholder="positive to add, negative to deduct"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
            />
          </label>
        </div>
        <label>
          Reason
          <input
            required
            placeholder="Why is this adjustment being made?"
            value={adjReason}
            onChange={(e) => setAdjReason(e.target.value)}
          />
        </label>
        <ErrorBox error={adjError} />
        {adjResult && (
          <div className="alert alert-ok">
            Adjusted <b>{adjUser?.username}</b> by {adjResult.amount > 0 ? `+${adjResult.amount}` : adjResult.amount}.
            New available balance: <b>{adjResult.balanceAfter}</b>.
          </div>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={adjBusy || !adjUser}>
            {adjBusy ? 'Applying...' : 'Apply adjustment'}
          </button>
        </div>
      </form>

      {/* ---- User history lookup ---- */}
      <h2>User history lookup</h2>
      <div className="filters card">
        <UserPicker label="User" selected={lookupUser} onSelect={(u) => { setLookupUser(u); setHistoryPage(1); setBalanceAtResult(null); setBalanceAtTs(''); setBalanceAtError(null); }} />
      </div>
      <ErrorBox error={historyError} />

      {lookupUser && (
        <form className="card stack" onSubmit={lookupBalanceAt}>
          <span className="eyebrow">Balance at a point in time</span>
          <div className="row">
            <input
              type="datetime-local"
              required
              value={balanceAtTs}
              onChange={(e) => { setBalanceAtTs(e.target.value); setBalanceAtResult(null); }}
              style={{ flex: 1 }}
            />
            <button type="submit">Check</button>
          </div>
          <ErrorBox error={balanceAtError} />
          {balanceAtResult !== null && (
            <div className="row">
              <span className="muted">Available balance at that time:</span>
              <b className="credits-mid">{balanceAtResult}</b>
            </div>
          )}
        </form>
      )}

      {lookupUser && history && history.data.length === 0 && <p className="muted">No ledger entries for this user.</p>}
      {history && history.data.length > 0 && (
        <>
          <table className="responsive">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th className="num">Credits</th>
                <th className="num">Available after</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((row) => (
                <tr key={row.id}>
                  <td data-label="When">{dayAndTime(row.created_at)}</td>
                  <td data-label="Type">{TYPE_LABEL[row.type] ?? row.type}</td>
                  <td data-label="Credits" className={`num ${row.amount >= 0 ? 'plus' : 'minus'}`}>
                    {row.amount > 0 ? `+${row.amount}` : row.amount < 0 ? `\u2212${Math.abs(row.amount)}` : '0'}
                  </td>
                  <td data-label="Available after" className="num">
                    {row.balance_after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.pagination.totalItems > LIMIT && (
            <Pagination
              page={history.pagination.page}
              limit={history.pagination.limit}
              total={history.pagination.totalItems}
              onPage={setHistoryPage}
            />
          )}
        </>
      )}
    </div>
  );
}
