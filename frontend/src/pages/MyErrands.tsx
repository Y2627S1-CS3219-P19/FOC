import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi, type Page } from '../api';
import { ErrorBox } from '../components';
import { ErrandCard } from '../errandParts';
import { ACTIVE_STATUSES, useNow, type Order } from '../errands';

/** The caller's errands: ones they requested, and ones they are running as a courier. */
export function MyErrandsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const as = params.get('as') === 'runner' ? 'runner' : 'requester';
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setOrders(null);
    api<Page<Order>>('GET', `/v1/orders/mine?as=${as}&limit=50`).then((r) => {
      setOrders(r.data);
      setTotal(r.total);
    }, setError);
  }, [api, as]);

  const active = orders?.filter((o) => ACTIVE_STATUSES.includes(o.status)) ?? [];
  const past = orders?.filter((o) => !ACTIVE_STATUSES.includes(o.status)) ?? [];
  const open = (o: Order) => navigate(`/errands/${o.id}`);

  return (
    <div className="stack">
      <div className="row between">
        <h1>My errands</h1>
        <Link className="button primary" to="/errands/new">
          + Request an errand
        </Link>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={as === 'requester'} onClick={() => setParams({}, { replace: true })}>
          Requesting
        </button>
        <button role="tab" aria-selected={as === 'runner'} onClick={() => setParams({ as: 'runner' }, { replace: true })}>
          Running
        </button>
      </div>
      <ErrorBox error={error} />
      {!orders && !error && <p>Loading…</p>}

      {orders && orders.length === 0 && (
        <div className="card soft stack">
          {as === 'requester' ? (
            <>
              <p>You haven't requested any errands yet.</p>
              <Link className="button primary" to="/errands/new">
                Request your first errand
              </Link>
            </>
          ) : (
            <>
              <p>You aren't running any errands. Pick one up on the board to earn credits.</p>
              <Link className="button primary" to="/board">
                Find an errand
              </Link>
            </>
          )}
        </div>
      )}

      {active.length > 0 && (
        <section className="stack">
          <h2>Active</h2>
          <div className="errand-list">
            {active.map((o) => (
              <ErrandCard key={o.id} order={o} now={now} onClick={() => open(o)} showStatus />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section className="stack">
          <h2>Past</h2>
          <div className="errand-list">
            {past.map((o) => (
              <ErrandCard key={o.id} order={o} now={now} onClick={() => open(o)} showStatus />
            ))}
          </div>
        </section>
      )}
      {total > 50 && <p className="small muted">Showing your 50 most recent errands.</p>}
    </div>
  );
}
