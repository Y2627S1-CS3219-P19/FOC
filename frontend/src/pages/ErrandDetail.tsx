import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, useApi } from '../api';
import { useAuth } from '../auth';
import { ConfirmButton, ErrorBox } from '../components';
import { PersonRow, SummaryRow, Timeline } from '../errandParts';
import {
  ACTIVE_STATUSES,
  REJECTION_TEXT,
  shortId,
  STATUS_LABEL,
  statusBadgeClass,
  timeLeft,
  useNow,
  type HistoryEntry,
  type Order,
} from '../errands';

type Action = 'accept' | 'withdraw' | 'collect' | 'deliver' | 'confirm' | 'cancel';
const AUTO_CONFIRM_HOURS = 24;

/** One errand, shown differently to its requester, its courier, and everyone else. */
export function ErrandDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const { claims } = useAuth();
  const now = useNow(15_000);
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [lostRace, setLostRace] = useState(false);

  const load = useCallback(() => {
    api<{ data: Order }>('GET', `/v1/orders/${id}`).then((r) => setOrder(r.data), setError);
    // Only the requester, the courier and admins may read the timeline.
    api<{ data: HistoryEntry[] }>('GET', `/v1/orders/${id}/timeline`).then(
      (r) => setHistory(r.data),
      () => setHistory([]),
    );
  }, [api, id]);

  useEffect(load, [load]);

  // Keep the page current: quickly while credits are being reserved, slower while the errand is active.
  const status = order?.status;
  useEffect(() => {
    if (!status || !ACTIVE_STATUSES.includes(status)) return;
    const t = setInterval(load, status === 'PENDING' ? 3_000 : 10_000);
    return () => clearInterval(t);
  }, [status, load]);

  const act = async (action: Action) => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/v1/orders/${id}/${action}`);
    } catch (err) {
      if (action === 'accept' && err instanceof ApiError && err.code === 'ALREADY_ACCEPTED') setLostRace(true);
      else setError(err);
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!order) {
    return (
      <div className="stack">
        <ErrorBox error={error} />
        {!error && <p>Loading…</p>}
      </div>
    );
  }

  const me = claims?.sub;
  const role = order.requesterId === me ? 'requester' : order.runnerId === me ? 'courier' : 'viewer';
  const nameOf = (actorId: string | null) => {
    if (!actorId) return 'System';
    if (actorId === me) return 'you';
    if (actorId === order.requesterId) return order.requester?.displayName ?? 'requester';
    if (actorId === order.runnerId) return order.runner?.displayName ?? 'courier';
    return 'a courier';
  };

  return (
    <div className="stack">
      <Link to={role === 'viewer' ? '/board' : '/errands'} className="small">
        ← {role === 'viewer' ? 'Back to the board' : 'My errands'}
      </Link>
      <div className="row between">
        <div className="stack-tight">
          <span className="eyebrow">Errand {shortId(order.id)}</span>
          <h1>
            {order.supplier.name} → {order.deliveryLocation}
          </h1>
        </div>
        <span className={statusBadgeClass(order.status)}>{STATUS_LABEL[order.status]}</span>
      </div>
      <ErrorBox error={error} />

      <div className="two-col">
        <div className="stack">
          {role === 'requester' && <RequesterPanel order={order} now={now} busy={busy} act={act} />}
          {role === 'courier' && <CourierPanel order={order} now={now} busy={busy} act={act} />}
          {role === 'viewer' && <ViewerPanel order={order} now={now} busy={busy} act={act} lostRace={lostRace} />}

          <div className="card stack">
            <div className="stack-tight">
              <span className="eyebrow">Collect</span>
              <b>{order.supplier.name}</b>
              <span className="small muted">
                {order.supplier.building}
                {order.supplier.floor && `, level ${order.supplier.floor}`}
                {order.supplier.locationDescription && ` · ${order.supplier.locationDescription}`}
              </span>
            </div>
            <div className="stack-tight">
              <span className="eyebrow">Deliver to</span>
              <b>{order.deliveryLocation}</b>
            </div>
            <div className="stack-tight">
              <span className="eyebrow">Items</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {order.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
              <span className="small muted">The courier pays the store; you settle the item cost with them off-platform.</span>
            </div>
          </div>
        </div>

        <aside className="stack">
          <div className="card stack">
            {order.requester !== undefined && <PersonRow person={order.requester} role="Requester" />}
            {order.runnerId && <PersonRow person={order.runner} role="Courier" fallback="Your courier" />}
            {!order.runnerId && order.status === 'OPEN' && <span className="muted">No courier yet.</span>}
          </div>
          {history.length > 0 && (
            <div className="card stack">
              <span className="eyebrow">Timeline</span>
              <Timeline history={history} nameOf={nameOf} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

interface PanelProps {
  order: Order;
  now: number;
  busy: boolean;
  act: (a: Action) => void;
}

function autoConfirmLeft(order: Order, now: number) {
  if (!order.deliveredAt) return null;
  return timeLeft(new Date(new Date(order.deliveredAt).getTime() + AUTO_CONFIRM_HOURS * 3_600_000).toISOString(), now);
}

function RequesterPanel({ order, now, busy, act }: PanelProps) {
  const n = order.creditAmount;
  switch (order.status) {
    case 'PENDING':
      return (
        <div className="card stack">
          <h2>Reserving your credits…</h2>
          <p className="muted">
            Your errand goes live as soon as {n} credits are held. This usually takes a second; this page updates by itself.
          </p>
        </div>
      );
    case 'REJECTED':
      return (
        <div className="card stack">
          <h2>Couldn't post this errand</h2>
          <p>{REJECTION_TEXT[order.rejection?.reason ?? ''] ?? 'The credits could not be reserved.'}</p>
          {order.rejection?.availableBalance != null && (
            <p className="muted">
              You have {order.rejection.availableBalance} credits available; this errand offered {n}.
            </p>
          )}
          <Link className="button primary" to={`/errands/new?supplier=${order.supplier.id}`}>
            Try again
          </Link>
        </div>
      );
    case 'OPEN': {
      const left = timeLeft(order.expiresAt, now);
      return (
        <div className="card stack">
          <h2>Waiting for a courier</h2>
          <p className="muted">
            {left ? `Expires in ${left} if nobody accepts.` : 'Expiring now.'} If it expires, your {n} credits come straight back.
          </p>
          <HeldCredits n={n} />
          <ConfirmButton label="Cancel errand" confirmLabel="Yes, cancel it" onConfirm={() => act('cancel')} />
        </div>
      );
    }
    case 'ACCEPTED':
    case 'COLLECTED':
      return (
        <div className="card stack">
          <h2>{order.status === 'ACCEPTED' ? 'Your courier is heading to the store' : 'Picked up · on the way to you'}</h2>
          <HeldCredits n={n} />
        </div>
      );
    case 'DELIVERED': {
      const left = autoConfirmLeft(order, now);
      return (
        <div className="card stack">
          <h2>Delivered. Did you get everything?</h2>
          <p className="muted">
            Confirming pays your courier {n} credits. {left ? `If you don't, it confirms itself in ${left}.` : ''}
          </p>
          <button className="primary big" disabled={busy} onClick={() => act('confirm')}>
            Confirm delivery
          </button>
        </div>
      );
    }
    case 'COMPLETED':
      return (
        <div className="card stack">
          <h2>Delivered.</h2>
          <p>
            <b>{n} credits</b> moved from your reserve to {order.runner?.displayName ?? 'your courier'}.
          </p>
          <div className="row wrap">
            <Link className="button primary" to="/errands/new">
              Request another
            </Link>
            <Link className="button" to="/credits">
              View my credits
            </Link>
          </div>
        </div>
      );
    default:
      return (
        <div className="card stack">
          <h2>{order.status === 'EXPIRED' ? 'Expired: nobody accepted in time' : 'Cancelled'}</h2>
          <p className="muted">Your {n} credits were returned to your balance.</p>
          <Link className="button" to={`/errands/new?supplier=${order.supplier.id}`}>
            Post it again
          </Link>
        </div>
      );
  }
}

function HeldCredits({ n }: { n: number }) {
  return (
    <div className="card soft row between">
      <div className="stack-tight">
        <span className="eyebrow">Held for this errand</span>
        <span className="small muted">Transfers to your courier the moment you confirm delivery.</span>
      </div>
      <span className="credits-mid">{n}</span>
    </div>
  );
}

function CourierPanel({ order, now, busy, act }: PanelProps) {
  const [checked, setChecked] = useState<boolean[]>(() => order.items.map(() => false));
  const n = order.creditAmount;
  const requester = order.requester?.displayName ?? 'the requester';
  switch (order.status) {
    case 'ACCEPTED':
      return (
        <div className="card stack">
          <span className="eyebrow">Step 1 of 2 · collect at the store</span>
          <h2>{order.supplier.name}</h2>
          <span className="muted">Then deliver to {order.deliveryLocation}</span>
          <div className="checklist stack-tight">
            {order.items.map((it, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={checked[i] ?? false}
                  onChange={(e) => setChecked((c) => c.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                {it}
              </label>
            ))}
          </div>
          <button className="primary big" disabled={busy} onClick={() => act('collect')}>
            I've collected the items
          </button>
          <ConfirmButton label="Can't do this run" confirmLabel="Give it back" className="ghost" onConfirm={() => act('withdraw')} />
          <span className="small muted">Giving it back reopens the errand for other couriers. You can only do this before pickup.</span>
        </div>
      );
    case 'COLLECTED':
      return (
        <div className="card stack">
          <span className="eyebrow">Step 2 of 2 · deliver</span>
          <h2>{order.deliveryLocation}</h2>
          <button className="primary big" disabled={busy} onClick={() => act('deliver')}>
            Mark as delivered
          </button>
          <EarnCard n={n} requester={requester} />
        </div>
      );
    case 'DELIVERED': {
      const left = autoConfirmLeft(order, now);
      return (
        <div className="card stack">
          <h2>Delivered: waiting for {requester} to confirm</h2>
          <p className="muted">
            Nothing has moved yet. Credits change hands only when {requester} confirms{left ? `, or automatically in ${left}` : ''}.
          </p>
          <EarnCard n={n} requester={requester} />
        </div>
      );
    }
    case 'COMPLETED':
      return (
        <div className="card stack">
          <span className="credits-big plus">+{n}</span>
          <h2>Credits received</h2>
          <p className="muted">{requester} confirmed the delivery. Your run is complete.</p>
          <div className="row wrap">
            <Link className="button primary" to="/board">
              Find another errand
            </Link>
            <Link className="button" to="/credits">
              View my credits
            </Link>
          </div>
        </div>
      );
    default:
      return (
        <div className="card">
          <p>{STATUS_LABEL[order.status]}</p>
        </div>
      );
  }
}

function EarnCard({ n, requester }: { n: number; requester: string }) {
  return (
    <div className="card soft row between">
      <div className="stack-tight">
        <span className="eyebrow">You'll earn</span>
        <span className="small muted">Reserved by {requester}, paid to you when they confirm.</span>
      </div>
      <span className="credits-mid">+{n}</span>
    </div>
  );
}

function ViewerPanel({ order, now, busy, act, lostRace }: PanelProps & { lostRace: boolean }) {
  if (lostRace) {
    return (
      <div className="card stack">
        <h2>Someone was faster</h2>
        <p className="muted">Another courier accepted this errand first. Nothing was reserved or charged on your side.</p>
        <Link className="button" to="/board">
          Back to the board
        </Link>
      </div>
    );
  }
  if (order.status !== 'OPEN') {
    return (
      <div className="card">
        <p>{STATUS_LABEL[order.status]}</p>
      </div>
    );
  }
  const left = timeLeft(order.expiresAt, now);
  return (
    <div className="card stack">
      <div className="row between">
        <div className="stack-tight">
          <span className="eyebrow">You'll earn</span>
          <span className="small muted">{left ? `Expires in ${left}` : 'Expiring now'}</span>
        </div>
        <span className="credits-mid">{order.creditAmount}</span>
      </div>
      <button className="primary big" disabled={busy} onClick={() => act('accept')}>
        Accept errand · earn {order.creditAmount} credits
      </button>
      <span className="small muted">Only one courier can be assigned. The credits stay reserved by the requester until you deliver.</span>
    </div>
  );
}
