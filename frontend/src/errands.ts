import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import { useAuth } from './auth';

// The UI says "errand" and "courier"; the API says "order" and "runner".

export type OrderStatus =
  | 'PENDING'
  | 'REJECTED'
  | 'OPEN'
  | 'ACCEPTED'
  | 'COLLECTED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface Person {
  id: string;
  displayName: string;
  rating: number | null;
}

export interface Order {
  id: string;
  status: OrderStatus;
  requesterId: string;
  runnerId: string | null;
  supplier: { id: string; name: string; facilityType: string; building: string; floor: string | null; locationDescription: string };
  deliveryLocation: string;
  items: string[];
  creditAmount: number;
  expiresAt: string;
  deliveredAt: string | null;
  rejection: { reason: string; availableBalance: number | null } | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  // Only on GET /v1/orders/:id
  requester?: Person | null;
  runner?: Person | null;
}

export interface HistoryEntry {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorId: string | null;
  occurredAt: string;
  reason: string | null;
}

export interface Wallet {
  availableBalance: number;
  reservedBalance: number;
  totalBalance: number;
}

export interface LedgerRow {
  id: string;
  reservation_id: string | null;
  type: 'ISSUANCE' | 'RESERVE' | 'SETTLE_DEBIT' | 'SETTLE_CREDIT' | 'RELEASE' | 'ADJUSTMENT';
  amount: number;
  balance_after: number;
  created_at: string;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Reserving credits…',
  REJECTED: "Couldn't post",
  OPEN: 'Waiting for a courier',
  ACCEPTED: 'Courier heading to the store',
  COLLECTED: 'Picked up · on the way',
  DELIVERED: 'Delivered · awaiting confirmation',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const ACTIVE_STATUSES: OrderStatus[] = ['PENDING', 'OPEN', 'ACCEPTED', 'COLLECTED', 'DELIVERED'];

export const REJECTION_TEXT: Record<string, string> = {
  INSUFFICIENT_CREDITS: "You didn't have enough credits for this offer.",
  NO_WALLET: "Your account doesn't have a credit wallet yet.",
  CREDIT_TIMEOUT: "The credit system didn't answer in time. Nothing was charged.",
};

export function statusBadgeClass(s: OrderStatus): string {
  if (s === 'COMPLETED' || s === 'OPEN') return 'badge badge-open';
  if (s === 'REJECTED' || s === 'CANCELLED' || s === 'EXPIRED') return 'badge badge-off';
  return 'badge badge-wait';
}

/** "12 min", "1 h 20 min", or null when the time has passed. */
export function timeLeft(iso: string, now = Date.now()): string | null {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayAndTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Today ${clock(iso)}` : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function shortId(id: string): string {
  return `#${id.slice(0, 6).toUpperCase()}`;
}

export function initials(name: string | undefined | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The caller's credit wallet. `refresh` reloads it after an action. */
export function useWallet() {
  const api = useApi();
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const refresh = useCallback(() => {
    if (!user) return;
    api<{ data: Wallet }>('GET', '/v1/credits/wallet').then(
      (r) => setWallet(r.data),
      () => setWallet(null),
    );
  }, [api, user]);
  useEffect(refresh, [refresh]);
  return { wallet, refresh };
}
