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
