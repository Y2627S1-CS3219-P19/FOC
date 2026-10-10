import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, useApi, type Page } from '../api';
import { ErrorBox, Pagination } from '../components';
import { ErrandCard, PersonRow, SummaryRow } from '../errandParts';
import { timeLeft, useNow, type Order } from '../errands';

const DEFAULTS = { building: '', facilityType: '', minCredit: '', sort: 'expiry', page: '1' };
type Filters = typeof DEFAULTS;
const LIMIT = 20;

function useWideScreen() {
  const query = '(min-width: 1051px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Open errands from other students. Couriers browse and accept here. */
export function BoardPage() {
  const api = useApi();
  const navigate = useNavigate();
  const wide = useWideScreen();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const filters: Filters = { ...DEFAULTS, ...Object.fromEntries(params) };
  const [result, setResult] = useState<Page<Order> | null>(null);
  const [options, setOptions] = useState<{ facilityTypes: string[]; buildings: string[] }>({ facilityTypes: [], buildings: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, page: '1', ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== '' && v !== DEFAULTS[k as keyof Filters])), { replace: true });
  };

  useEffect(() => {
    api<{ data: typeof options }>('GET', '/v1/suppliers/filter-options').then((r) => setOptions(r.data), () => undefined);
  }, [api]);

  const query = new URLSearchParams({
    page: filters.page,
    limit: String(LIMIT),
    sort: filters.sort === 'credit' ? 'credit' : 'expiry',
    order: filters.sort === 'credit' ? 'desc' : 'asc',
    ...(filters.building && { building: filters.building }),
    ...(filters.facilityType && { facilityType: filters.facilityType }),
    ...(filters.minCredit && { minCredit: filters.minCredit }),
  }).toString();

  useEffect(() => {
    api<Page<Order>>('GET', `/v1/orders?${query}`).then((r) => {
      setResult(r);
      setError(null);
    }, setError);
  }, [api, query, tick]);

  // "Live": refresh while the page is open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const open = (id: string) => (wide ? setSelected(id) : navigate(`/errands/${id}`));

  return (
    <div className="stack">
      <div className="row between">
        <div className="stack-tight">
          <h1>Open errands</h1>
          <span className="muted">
            {result ? `${result.total} open` : 'Loading…'} · live, refreshes every 15 seconds
          </span>
        </div>
        <Link className="button primary" to="/errands/new">
          + Request an errand
        </Link>
      </div>
      <ErrorBox error={error} />

      <div className={`board${selected && wide ? ' with-drawer' : ''}`}>
        <aside className="board-filters card stack">
          <label>
            Pickup building
            <select value={filters.building} onChange={(e) => update({ building: e.target.value })}>
              <option value="">All of campus</option>
              {options.buildings.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label>
            Facility type
            <select value={filters.facilityType} onChange={(e) => update({ facilityType: e.target.value })}>
              <option value="">Any</option>
              {options.facilityTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="stack-tight">
            <span className="eyebrow">Credits offered</span>
            <div className="chips">
              {[
                ['', 'Any'],
                ['3', '3+'],
                ['5', '5+'],
              ].map(([v, label]) => (
                <button key={v} type="button" className="chip" aria-pressed={filters.minCredit === v} onClick={() => update({ minCredit: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="stack-tight">
            <span className="eyebrow">Sort by</span>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={filters.sort === 'expiry'} onClick={() => update({ sort: 'expiry' })}>
                Expiring soonest
              </button>
              <button type="button" className="chip" aria-pressed={filters.sort === 'credit'} onClick={() => update({ sort: 'credit' })}>
                Most credits
              </button>
            </div>
          </div>
          <p className="small muted">Credits you earn stay on campus. They can't be bought or cashed out.</p>
        </aside>

        <section className="stack">
          {result && result.data.length === 0 && (
            <div className="card soft">
              <p>No open errands match right now. Your own errands never show here.</p>
            </div>
          )}
          <div className="errand-list">
            {result?.data.map((o) => (
              <ErrandCard key={o.id} order={o} now={now} selected={o.id === selected} onClick={() => open(o.id)} />
            ))}
          </div>
          {result && result.total > LIMIT && (
            <Pagination page={result.page} limit={result.limit} total={result.total} onPage={(p) => update({ page: String(p) })} />
          )}
        </section>

        {selected && wide && (
          <aside className="drawer">
            <ErrandDrawer id={selected} onClose={() => setSelected(null)} onChanged={() => setTick((n) => n + 1)} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Desktop side panel: details and Accept, without leaving the board. */
function ErrandDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const now = useNow();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrder(null);
    setError(null);
    api<{ data: Order }>('GET', `/v1/orders/${id}`).then((r) => setOrder(r.data), setError);
  }, [api, id]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/v1/orders/${id}/accept`);
      navigate(`/errands/${id}`);
    } catch (err) {
      setError(err);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const lostRace = error instanceof ApiError && error.code === 'ALREADY_ACCEPTED';
  const left = order ? timeLeft(order.expiresAt, now) : null;

  return (
    <div className="card stack">
      <div className="row between">
        <span className="eyebrow">Errand {order ? `· ${order.supplier.name}` : ''}</span>
        <button className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {lostRace ? (
        <div className="stack">
          <h2>Someone was faster</h2>
          <p className="muted">Another courier accepted this errand first. Nothing was reserved or charged on your side.</p>
          <button onClick={onClose}>Back to the board</button>
        </div>
      ) : (
        <>
          <ErrorBox error={error} />
          {order && (
            <>
              <div className="stack-tight">
                <b>Collect at {order.supplier.name}</b>
                <span className="small muted">
                  {order.supplier.building}
                  {order.supplier.floor && `, level ${order.supplier.floor}`}
                  {order.supplier.locationDescription && ` · ${order.supplier.locationDescription}`} · pay the store yourself
                </span>
              </div>
              <div className="stack-tight">
                <b>Deliver to {order.deliveryLocation}</b>
                <span className="small muted">{left ? `Expires in ${left} if nobody accepts` : 'Expiring now'}</span>
              </div>
              <ul className="stack-tight" style={{ margin: 0, paddingLeft: 18 }}>
                {order.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
              <PersonRow person={order.requester} role="Requester" />
              <SummaryRow label="You earn">
                <span className="credits-mid">{order.creditAmount}</span> credits
              </SummaryRow>
              <button className="primary big" disabled={busy} onClick={accept}>
                Accept errand
              </button>
              <span className="small muted">First accept wins: one courier per errand.</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
