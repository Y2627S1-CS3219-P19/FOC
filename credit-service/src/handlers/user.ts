import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Logger } from 'pino';
import {
  CREDIT_EVENTS,
  type EventEnvelope,
  type UserRegisteredPayload,
  addOutboxEvent,
} from '@foc/shared-events';

export async function handleUserRegistered(
  client: PoolClient,
  envelope: EventEnvelope<UserRegisteredPayload>,
  balance: number,
  log: Logger,
): Promise<void> {
  const { userId } = envelope.payload;

  // Create wallet with initial balance.
  await client.query(
    'INSERT INTO wallets (user_id, available_balance, reserved_balance) VALUES ($1, $2, 0) ON CONFLICT (user_id) DO NOTHING',
    [userId, balance],
  );

  // Record issuance in ledger.
  await client.query(
    `INSERT INTO ledger (id, user_id, reservation_id, type, amount, balance_after)
     VALUES ($1, $2, NULL, 'ISSUANCE', $3, $3)`,
    [randomUUID(), userId, balance],
  );

  // Publish CreditWalletCreated event via outbox.
  await addOutboxEvent(client, CREDIT_EVENTS.walletCreated, { userId, initialBalance: balance }, envelope.correlationId);

  log.info({ userId, balance }, 'Wallet created for new user');
}
