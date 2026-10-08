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
export interface OrderOpenedPayload {
  orderId: string;
  requesterId: string;
}
export interface OrderRejectedPayload {
  orderId: string;
  requesterId: string;
  reason: string;
}

const define = <T>(type: string, exchange: string, routingKey: string): EventDefinition<T> => ({
  type,
  exchange,
  routingKey,
  version: 1,
});

export const LOCAL_ORDER_EVENTS = {
  opened: define<OrderOpenedPayload>('OrderOpened', EXCHANGES.order, 'order.opened'),
  rejected: define<OrderRejectedPayload>('OrderRejected', EXCHANGES.order, 'order.rejected'),
  accepted: define<OrderRunnerPayload>('OrderAccepted', EXCHANGES.order, 'order.accepted'),
  collected: define<OrderRunnerPayload>('OrderCollected', EXCHANGES.order, 'order.collected'),
  delivered: define<OrderRunnerPayload>('OrderDelivered', EXCHANGES.order, 'order.delivered'),
  reopened: define<OrderReopenedPayload>('OrderReopened', EXCHANGES.order, 'order.reopened'),
} as const;

// TODO(credit owner): the failure reply Order Service expects from Credit Service. Add it to CREDIT_EVENTS.
export interface CreditReservationFailedPayload {
  orderId: string;
  requesterId: string;
  amount: number;
  availableBalance: number | null;
  reason: 'INSUFFICIENT_CREDITS' | 'NO_WALLET';
}

export const CREDIT_RESERVATION_FAILED = define<CreditReservationFailedPayload>(
  'CreditReservationFailed',
  EXCHANGES.credit,
  'credit.reservation_failed',
);
