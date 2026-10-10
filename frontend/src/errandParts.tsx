import type { ReactNode } from 'react';
import { clock, initials, STATUS_LABEL, statusBadgeClass, timeLeft, type HistoryEntry, type Order, type Person } from './errands';

/** One errand in a list: route, items, timing, and the credit offer. */
export function ErrandCard({ order, now, selected, onClick, showStatus = false }: {
  order: Order;
  now: number;
  selected?: boolean;
  onClick: () => void;
  showStatus?: boolean;
}) {
  const left = timeLeft(order.expiresAt, now);
  return (
    <button type="button" className={`errand-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className="route">
        {order.supplier.name} → {order.deliveryLocation}
      </span>
      <span className="offer">
        <b>{order.creditAmount}</b>
        <span className="small muted">credits</span>
      </span>
      <span className="muted">{order.items.join(', ')}</span>
      <span className="small muted">
        {showStatus && <span className={statusBadgeClass(order.status)}>{STATUS_LABEL[order.status]}</span>}
        {order.supplier.building}
        {order.status === 'OPEN' && (left ? ` · expires in ${left}` : ' · expiring now')}
      </span>
    </button>
  );
}

export function PersonRow({ person, role, fallback }: { person: Person | null | undefined; role: string; fallback?: string }) {
  const name = person?.displayName ?? fallback ?? 'Someone';
  return (
    <div className="person">
      <span className="avatar">{initials(name)}</span>
      <div className="stack-inline">
        <b>{name}</b>
        <span className="small muted">
          {role}
          {person?.rating != null && ` · ★ ${person.rating.toFixed(1)}`}
        </span>
      </div>
    </div>
  );
}

const STEP_TEXT: Partial<Record<HistoryEntry['toStatus'], string>> = {
  PENDING: 'Posted',
  OPEN: 'Credits reserved · open for couriers',
  ACCEPTED: 'Accepted by a courier',
  COLLECTED: 'Items picked up',
  DELIVERED: 'Delivered',
  COMPLETED: 'Confirmed · credits paid to the courier',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired before anyone accepted · credits returned',
  REJECTED: 'Not posted',
};

/** Status history, oldest first. The last step is highlighted as "now". */
export function Timeline({ history, nameOf }: { history: HistoryEntry[]; nameOf: (id: string | null) => string }) {
  return (
    <ol className="timeline">
      {history.map((h, i) => {
        const last = i === history.length - 1;
        const reopened = h.fromStatus === 'ACCEPTED' && h.toStatus === 'OPEN';
        const text = reopened ? 'Courier gave the errand back · open again' : (STEP_TEXT[h.toStatus] ?? h.toStatus);
        return (
          <li key={i} className={last ? 'now' : 'done'}>
            <div className="stack-inline">
              <b>{text}</b>
              <span className="small muted">
                {clock(h.occurredAt)}
                {h.actorId ? ` · ${nameOf(h.actorId)}` : h.reason ? ` · ${h.reason.replace(/_/g, ' ').toLowerCase()}` : ''}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="summary-row">
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
