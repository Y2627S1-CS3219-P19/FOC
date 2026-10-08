// AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: the order state machine (single source of truth). Reviewed by <name>.
import {
  ORDER_EVENTS,
  type EventDefinition,
  type OrderCancelledPayload,
  type OrderCompletedPayload,
  type OrderCreatedPayload,
  type OrderExpiredPayload,
} from '@foc/shared-events';
import { LOCAL_ORDER_EVENTS, type OrderReopenedPayload, type OrderRunnerPayload } from '../events/localEvents.js';
import type { OrderRow, OrderStatus } from './order.js';

/**
 * Who may trigger a transition. Decided per order, never by account role:
 * - requester:    the caller is order.requester_id
 * - runner:       the caller is order.runner_id
 * - nonRequester: any logged-in user except order.requester_id
 * - system:       a background job
 */
export type Actor = 'requester' | 'runner' | 'nonRequester' | 'system';

/** Credit effect, using CREDIT_EVENTS words: returned = back to requester, released = paid to runner. */
export type CreditEffect = 'none' | 'reserve (sync, before insert)' | 'return to requester' | 'release to runner';

export type Action = 'accept' | 'withdraw' | 'collect' | 'deliver' | 'confirm' | 'cancel' | 'expire';

type Versioned<T> = T & { orderVersion: number };

export interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  actors: Actor[];
  /** Extra WHERE conditions on top of id, status and the actor check. */
  where: string[];
  /** Extra SET clauses on top of status, version and updated_at. */
  set: string[];
  credit: CreditEffect;
  trigger: string;
  event: EventDefinition<object>;
  /** `order` is the row AFTER the update. `actorId` is null for the system. */
  payload: (order: OrderRow, actorId: string | null) => object;
}

const versioned = <T>(order: OrderRow, payload: T): Versioned<T> => ({ ...payload, orderVersion: order.version });

// runner_id is never null in ACCEPTED/COLLECTED/DELIVERED/COMPLETED (DB check orders_runner_matches_status).
const runnerPayload = (o: OrderRow) =>
  versioned<OrderRunnerPayload>(o, { orderId: o.id, requesterId: o.requester_id, runnerId: o.runner_id! });

export const TRANSITIONS: Record<Action, Transition> = {
  accept: {
    from: 'OPEN',
    to: 'ACCEPTED',
    actors: ['nonRequester'],
    where: ['expires_at > now()'],
    set: ['runner_id = $2'],
    credit: 'none',
    trigger: 'POST /v1/orders/:id/accept',
    event: LOCAL_ORDER_EVENTS.accepted,
    payload: runnerPayload,
  },
  withdraw: {
    from: 'ACCEPTED',
    to: 'OPEN',
    actors: ['runner'],
    where: [],
    set: ['runner_id = NULL'],
    credit: 'none',
    trigger: 'POST /v1/orders/:id/withdraw',
    event: LOCAL_ORDER_EVENTS.reopened,
    payload: (o, actorId) =>
      versioned<OrderReopenedPayload>(o, { orderId: o.id, requesterId: o.requester_id, previousRunnerId: actorId! }),
  },
  collect: {
    from: 'ACCEPTED',
    to: 'COLLECTED',
    actors: ['runner'],
    where: [],
    set: [],
    credit: 'none',
    trigger: 'POST /v1/orders/:id/collect',
    event: LOCAL_ORDER_EVENTS.collected,
    payload: runnerPayload,
  },
  deliver: {
    from: 'COLLECTED',
    to: 'DELIVERED',
    actors: ['runner'],
    where: [],
    set: ['delivered_at = now()'],
    credit: 'none',
    trigger: 'POST /v1/orders/:id/deliver',
    event: LOCAL_ORDER_EVENTS.delivered,
    payload: runnerPayload,
  },
  confirm: {
    from: 'DELIVERED',
    to: 'COMPLETED',
    actors: ['requester', 'system'],
    where: [],
    set: [],
    credit: 'release to runner',
    trigger: 'POST /v1/orders/:id/confirm, or auto-confirm job after AUTO_CONFIRM_AFTER_HOURS',
    event: ORDER_EVENTS.completed,
    payload: (o) =>
      versioned<OrderCompletedPayload>(o, {
        orderId: o.id,
        requesterId: o.requester_id,
        runnerId: o.runner_id!,
        creditAmount: o.credit_amount,
      }),
  },
  cancel: {
    from: 'OPEN',
    to: 'CANCELLED',
    actors: ['requester'],
    where: [],
    set: [],
    credit: 'return to requester',
    trigger: 'POST /v1/orders/:id/cancel',
    event: ORDER_EVENTS.cancelled,
    payload: (o, actorId) => versioned<OrderCancelledPayload>(o, { orderId: o.id, cancelledBy: actorId! }),
  },
  expire: {
    from: 'OPEN',
    to: 'EXPIRED',
    actors: ['system'],
    where: ['expires_at <= now()'],
    set: [],
    credit: 'return to requester',
    trigger: 'expiry job every EXPIRY_SWEEP_MS',
    event: ORDER_EVENTS.expired,
    payload: (o) => versioned<OrderExpiredPayload>(o, { orderId: o.id }),
  },
};

/** Order creation is an INSERT, not an UPDATE, so it is kept apart from TRANSITIONS. */
export const CREATE = {
  to: 'OPEN' as const,
  actors: ['any logged-in user (becomes the requester)'],
  credit: 'reserve (sync, before insert)' as CreditEffect,
  trigger: 'POST /v1/orders',
  event: ORDER_EVENTS.created,
  payload: (o: OrderRow) =>
    versioned<OrderCreatedPayload>(o, { orderId: o.id, requesterId: o.requester_id, creditAmount: o.credit_amount }),
};

/** $2 is always the caller's id. System transitions have no $2. */
const ACTOR_SQL: Record<Actor, string | null> = {
  requester: 'requester_id = $2',
  runner: 'runner_id = $2',
  nonRequester: 'requester_id <> $2',
  system: null,
};

/**
 * The single conditional UPDATE for a transition. Params: $1 = order id, $2 = caller id (not for system).
 * Zero rows back means the order is missing, the caller is not allowed, or the status changed first.
 */
export function updateSql(action: Action, actor: Actor): string {
  const t = TRANSITIONS[action];
  if (!t.actors.includes(actor)) throw new Error(`${actor} cannot ${action}`);
  const set = [`status = '${t.to}'`, 'version = version + 1', 'updated_at = now()', ...t.set];
  const actorSql = ACTOR_SQL[actor];
  const where = ['id = $1', `status = '${t.from}'`, ...(actorSql ? [actorSql] : []), ...t.where];
  return `UPDATE orders SET ${set.join(', ')} WHERE ${where.join(' AND ')} RETURNING *`;
}

/** True if `action` is a legal move from `status`. */
export function isAllowedFrom(action: Action, status: OrderStatus): boolean {
  return TRANSITIONS[action].from === status;
}
