import type { PoolClient } from 'pg';
import { addOutboxEvent } from '@foc/shared-events';
import type { OrderRow } from '../domain/order.js';
import { TRANSITIONS, updateSql, type Action, type Actor } from '../domain/transitions.js';
import { insertHistory } from '../repositories/orderRepository.js';

export interface TransitionInput {
  action: Action;
  actor: Actor;
  orderId: string;
  /** The caller's user id; null for the system. */
  actorId: string | null;
  correlationId?: string | null;
  reason?: string | null;
}

/**
 * Conditional UPDATE + history row + outbox event. Run it inside a transaction the caller owns.
 * Returns null when 0 rows changed (order missing, caller not allowed, or status already moved on).
 */
export async function applyTransition(client: PoolClient, input: TransitionInput): Promise<OrderRow | null> {
  const t = TRANSITIONS[input.action];
  const params = input.actor === 'system' ? [input.orderId] : [input.orderId, input.actorId];
  const { rows } = await client.query<OrderRow>(updateSql(input.action, input.actor), params);
  const order = rows[0];
  if (!order) return null;

  await insertHistory(client, { orderId: order.id, from: t.from, to: t.to, actorId: input.actorId, reason: input.reason });
  await addOutboxEvent(client, t.event, t.payload(order, input.actorId, input.reason ?? null), input.correlationId);
  return order;
}
