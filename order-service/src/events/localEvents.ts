// AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: order events missing from shared-events. Reviewed by <name>.
import { EXCHANGES, type EventDefinition } from '@foc/shared-events';

// TODO(team): move these into packages/shared-events once agreed.
// The runner withdraw uses order.reopened, NOT ORDER_EVENTS.withdrawn: Credit Service treats withdrawn as a refund.

export interface OrderRunnerPayload {
  orderId: string;
  requesterId: string;
  runnerId: string;
}
export interface OrderReopenedPayload {
  orderId: string;
  requesterId: string;
  previousRunnerId: string;
}

const local = <T>(type: string, routingKey: string): EventDefinition<T> => ({
  type,
  exchange: EXCHANGES.order,
  routingKey,
  version: 1,
});

export const LOCAL_ORDER_EVENTS = {
  accepted: local<OrderRunnerPayload>('OrderAccepted', 'order.accepted'),
  collected: local<OrderRunnerPayload>('OrderCollected', 'order.collected'),
  delivered: local<OrderRunnerPayload>('OrderDelivered', 'order.delivered'),
  reopened: local<OrderReopenedPayload>('OrderReopened', 'order.reopened'),
} as const;
