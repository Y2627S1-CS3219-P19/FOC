import { randomUUID } from 'node:crypto';
import { addOutboxEvent } from '@foc/shared-events';
import { badRequest, forbidden, notFound } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { withTransaction } from '../db.js';
import type { OrderRow } from '../domain/order.js';
import { CREATE } from '../domain/transitions.js';
import * as repo from '../repositories/orderRepository.js';
import type { ByUserQuery, CreateOrderInput, ListOpenQuery, MineQuery } from '../schemas.js';

/** The caller as the service sees them. Role decides admin rights only, never requester/runner. */
export interface Caller {
  userId: string;
  isAdmin: boolean;
  correlationId?: string;
}

const SUPPLIER_ERRORS = {
  NOT_FOUND: ['SUPPLIER_NOT_FOUND', 'That supplier does not exist.'],
  INACTIVE: ['SUPPLIER_INACTIVE', 'That supplier is not active right now.'],
  CLOSED: ['SUPPLIER_CLOSED', 'That supplier is closed right now. Try again during its opening hours.'],
} as const;

/**
 * validate -> one transaction (PENDING order + history + order.created in the outbox).
 * Credit Service reserves when it consumes order.created and replies with an event; the credit consumer
 * then moves the order to OPEN or REJECTED.
 */
export async function createOrder(ctx: AppContext, caller: Caller, input: CreateOrderInput): Promise<OrderRow> {
  const { pool, clients, logger } = ctx;

  const expiry = await repo.checkExpiry(pool, input.expiresAt);
  if (!expiry.inFuture) throw badRequest('EXPIRY_NOT_IN_FUTURE', 'Expiry time must be in the future.');
  if (!expiry.within24h) throw badRequest('EXPIRY_TOO_FAR', 'Expiry time must be at most 24 hours from now.');

  const check = await clients.supplier.validate(input.supplierId, caller.correlationId);
  if (!check.valid) {
    const [code, message] = SUPPLIER_ERRORS[check.reason];
    throw badRequest(code, message);
  }

  const orderId = randomUUID();
  const order = await withTransaction(pool, async (client) => {
    const row = await repo.insertOrder(client, {
      id: orderId,
      requesterId: caller.userId,
      supplier: check.supplier,
      deliveryLocation: input.deliveryLocation,
      items: input.items,
      creditAmount: input.creditAmount,
      expiresAt: input.expiresAt,
    });
    await repo.insertHistory(client, { orderId, from: null, to: CREATE.to, actorId: caller.userId });
    await addOutboxEvent(client, CREATE.event, CREATE.payload(row), caller.correlationId);
    return row;
  });
  logger.info({ orderId, requesterId: caller.userId, to: CREATE.to, correlationId: caller.correlationId }, 'Order created');
  return order;
}

function canView(order: OrderRow, caller: Caller): boolean {
  return caller.isAdmin || order.requester_id === caller.userId || order.runner_id === caller.userId;
}

async function loadOrder(ctx: AppContext, id: string): Promise<OrderRow> {
  const order = await repo.findOrder(ctx.pool, id);
  if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found.');
  return order;
}

/** Requester, assigned runner or admin. OPEN orders are visible to any logged-in user so runners can browse them. */
export async function getOrder(ctx: AppContext, caller: Caller, id: string) {
  const order = await loadOrder(ctx, id);
  if (order.status !== 'OPEN' && !canView(order, caller)) {
    throw forbidden('NOT_ORDER_PARTICIPANT', 'Only the requester or the assigned runner can view this order.');
  }
  const [requester, runner] = await Promise.all([
    ctx.clients.user.summary(order.requester_id, caller.correlationId),
    order.runner_id ? ctx.clients.user.summary(order.runner_id, caller.correlationId) : null,
  ]);
  return { order, requester, runner };
}

/** Requester, assigned runner or admin only (even for OPEN orders). */
export async function getTimeline(ctx: AppContext, caller: Caller, id: string) {
  const order = await loadOrder(ctx, id);
  if (!canView(order, caller)) {
    throw forbidden('NOT_ORDER_PARTICIPANT', 'Only the requester or the assigned runner can view this timeline.');
  }
  return repo.findHistory(ctx.pool, id);
}

export function listOpen(ctx: AppContext, caller: Caller, q: ListOpenQuery) {
  if (q.minCredit !== undefined && q.maxCredit !== undefined && q.minCredit > q.maxCredit) {
    throw badRequest('INVALID_RANGE', 'minCredit cannot be more than maxCredit.');
  }
  if (
    q.minRemainingMinutes !== undefined &&
    q.maxRemainingMinutes !== undefined &&
    q.minRemainingMinutes > q.maxRemainingMinutes
  ) {
    throw badRequest('INVALID_RANGE', 'minRemainingMinutes cannot be more than maxRemainingMinutes.');
  }
  return repo.listOpen(ctx.pool, caller.userId, q);
}

export function listMine(ctx: AppContext, caller: Caller, q: MineQuery) {
  return repo.listMine(ctx.pool, caller.userId, q);
}

export function listByUser(ctx: AppContext, userId: string, q: ByUserQuery) {
  return repo.listByUser(ctx.pool, userId, q);
}
