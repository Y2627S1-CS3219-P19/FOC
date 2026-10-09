/**
 * Event contracts. Every message on RabbitMQ is an EventEnvelope, published to a durable TOPIC exchange
 * owned by the producing service (user.events, order.events, credit.events) with a routing key like
 * "user.registered". Consumers bind their own durable queues to the routing keys they care about.
 */
export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string | null;
  payload: TPayload;
}

export const EXCHANGES = {
  user: 'user.events',
  order: 'order.events',
  credit: 'credit.events',
} as const;

export interface EventDefinition<TPayload> {
  type: string;
  routingKey: string;
  exchange: string;
  version: number;
  /** Phantom field so TypeScript can infer the payload type. */
  readonly _payload?: TPayload;
}

function defineEvent<TPayload>(type: string, exchange: string, routingKey: string, version = 1): EventDefinition<TPayload> {
  return { type, exchange, routingKey, version };
}

export interface UserRegisteredPayload {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  registeredAt: string;
}
export interface UserSuspendedPayload {
  userId: string;
  suspendedBy: string;
  reason: string;
}
export interface UserReinstatedPayload {
  userId: string;
  reinstatedBy: string;
}
export interface UserRoleChangedPayload {
  userId: string;
  oldRole: 'user' | 'admin';
  newRole: 'user' | 'admin';
  requestedBy: string;
  approvedBy: string;
}

export const USER_EVENTS = {
  registered: defineEvent<UserRegisteredPayload>('UserRegistered', EXCHANGES.user, 'user.registered'),
  suspended: defineEvent<UserSuspendedPayload>('UserSuspended', EXCHANGES.user, 'user.suspended'),
  reinstated: defineEvent<UserReinstatedPayload>('UserReinstated', EXCHANGES.user, 'user.reinstated'),
  roleChanged: defineEvent<UserRoleChangedPayload>('UserRoleChanged', EXCHANGES.user, 'user.role_changed'),
} as const;

// ── Order events (published by order-service, consumed by credit-service) ──

export interface OrderCreatedPayload {
  orderId: string;
  requesterId: string;
  creditAmount: number;
}
export interface OrderCompletedPayload {
  orderId: string;
  requesterId: string;
  runnerId: string;
  creditAmount: number;
}
export interface OrderWithdrawnPayload {
  orderId: string;
}
export interface OrderCancelledPayload {
  orderId: string;
  cancelledBy: string;
}
export interface OrderExpiredPayload {
  orderId: string;
}

export const ORDER_EVENTS = {
  created: defineEvent<OrderCreatedPayload>('OrderCreated', EXCHANGES.order, 'order.created'),
  completed: defineEvent<OrderCompletedPayload>('OrderCompleted', EXCHANGES.order, 'order.completed'),
  withdrawn: defineEvent<OrderWithdrawnPayload>('OrderWithdrawn', EXCHANGES.order, 'order.withdrawn'),
  cancelled: defineEvent<OrderCancelledPayload>('OrderCancelled', EXCHANGES.order, 'order.cancelled'),
  expired: defineEvent<OrderExpiredPayload>('OrderExpired', EXCHANGES.order, 'order.expired'),
} as const;

// ── Credit events (published by credit-service) ──

export interface CreditWalletCreatedPayload {
  userId: string;
  initialBalance: number;
}
export interface CreditsReservedPayload {
  orderId: string;
  requesterId: string;
  amount: number;
}
export interface CreditsReturnedPayload {
  orderId: string;
  requesterId: string;
  amount: number;
  reason: string;
}
export interface CreditsReleasedPayload {
  orderId: string;
  requesterId: string;
  runnerId: string;
  amount: number;
}

export interface CreditReservationFailedPayload {
  orderId: string;
  requesterId: string;
  amount: number;
  availableBalance: number | null;
  reason: 'INSUFFICIENT_CREDITS' | 'NO_WALLET';
}

export const CREDIT_EVENTS = {
  walletCreated: defineEvent<CreditWalletCreatedPayload>('CreditWalletCreated', EXCHANGES.credit, 'credit.wallet_created'),
  reserved: defineEvent<CreditsReservedPayload>('CreditsReserved', EXCHANGES.credit, 'credit.reserved'),
  reservationFailed: defineEvent<CreditReservationFailedPayload>('CreditReservationFailed', EXCHANGES.credit, 'credit.reservation_failed'),
  returned: defineEvent<CreditsReturnedPayload>('CreditsReturned', EXCHANGES.credit, 'credit.returned'),
  released: defineEvent<CreditsReleasedPayload>('CreditsReleased', EXCHANGES.credit, 'credit.released'),
} as const;
