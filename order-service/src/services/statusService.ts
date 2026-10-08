import { conflict, forbidden, notFound } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import type { OrderRow } from '../domain/order.js';
import { TRANSITIONS, type Actor } from '../domain/transitions.js';
import { findOrder } from '../repositories/orderRepository.js';
import type { Caller } from './orderService.js';
import { applyTransition } from './transitionService.js';

/** The status changes a user can trigger over HTTP. open, reject and expire are system only. */
export type UserAction = 'accept' | 'withdraw' | 'collect' | 'deliver' | 'confirm' | 'cancel';

/** The one user actor allowed for each action (confirm also allows the system). */
const USER_ACTOR: Record<UserAction, Exclude<Actor, 'system'>> = {
  accept: 'nonRequester',
  withdraw: 'runner',
  collect: 'runner',
  deliver: 'runner',
  confirm: 'requester',
  cancel: 'requester',
};

/**
 * Runs one status change as a single conditional UPDATE (with history + outbox) in one transaction.
 * The order is only read when the UPDATE changes nothing, to explain why: 404, then 403, then 409.
 */
export async function changeStatus(ctx: AppContext, caller: Caller, action: UserAction, orderId: string): Promise<OrderRow> {
  const actor = USER_ACTOR[action];
  const updated = await withTransaction(ctx.pool, (client) =>
    applyTransition(client, { action, actor, orderId, actorId: caller.userId, correlationId: caller.correlationId }),
  );
  if (updated) {
    const t = TRANSITIONS[action];
    ctx.logger.info(
      { orderId, from: t.from, to: t.to, actorId: caller.userId, version: updated.version, correlationId: caller.correlationId },
      'Order transition',
    );
    return updated;
  }

  const order = await findOrder(ctx.pool, orderId);
  if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found.');

  // Confirming twice (or after auto-confirm) is not an error: return the order unchanged, no second event.
  if (action === 'confirm' && order.status === 'COMPLETED' && order.requester_id === caller.userId) return order;

  throw whyNot(action, actor, order, caller.userId);
}

/** Works out the error for a status change that did not happen. */
function whyNot(action: UserAction, actor: Actor, order: OrderRow, userId: string) {
  const isRequester = order.requester_id === userId;
  const isRunner = order.runner_id !== null && order.runner_id === userId;
  const t = TRANSITIONS[action];

  if (actor === 'nonRequester' && isRequester) {
    return forbidden('CANNOT_ACCEPT_OWN_ORDER', 'You cannot accept your own order.');
  }
  if (actor === 'requester' && !isRequester) {
    return isRunner
      ? forbidden('REQUESTER_ONLY', `Only the requester can ${action} this order.`)
      : forbidden('NOT_ORDER_PARTICIPANT', 'You are not the requester or the runner of this order.');
  }
  // A runner action on an order that has a runner, by someone else. With no runner yet, it is a status problem (409).
  if (actor === 'runner' && order.runner_id !== null && !isRunner) {
    return isRequester
      ? forbidden('RUNNER_ONLY', `Only the assigned runner can ${action} this order.`)
      : forbidden('NOT_ORDER_PARTICIPANT', 'You are not the requester or the runner of this order.');
  }

  if (action === 'accept' && order.status === 'OPEN') {
    return conflict('ORDER_EXPIRED', 'This order has expired and can no longer be accepted.');
  }
  if (action === 'accept' && order.runner_id !== null) {
    return conflict('ALREADY_ACCEPTED', 'Another runner has already accepted this order.', { status: order.status });
  }
  return conflict('ILLEGAL_TRANSITION', `Cannot ${action} an order that is ${order.status}. It must be ${t.from}.`, {
    status: order.status,
    requiredStatus: t.from,
  });
}
