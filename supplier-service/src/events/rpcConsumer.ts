import type { Channel, ConsumeMessage } from 'amqplib';
import type { SupplierRepository } from '../db/repository.js';
import { isOpenNow } from '../utils/time.js';

export const SUPPLIER_RPC_QUEUE = 'supplier.rpc.validate';
export const MAX_STALENESS_MS = 60_000;
export const DEFAULT_CUTOFF_BUFFER_MINUTES = 15;

export async function startSupplierRpcConsumer(
  channel: Channel,
  repository: SupplierRepository
): Promise<void> {
  // Durable queue ensures definition and queued messages survive broker restarts
  await channel.assertQueue(SUPPLIER_RPC_QUEUE, { durable: true });

  // Operational note: channel.prefetch(N) can be added here if backpressure / concurrency throttling is needed in the future.

  await channel.consume(SUPPLIER_RPC_QUEUE, async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const { replyTo, correlationId } = msg.properties;
      if (!replyTo) {
        channel.nack(msg, false, false);
        return;
      }

      let body: any;
      try {
        body = JSON.parse(msg.content.toString());
      } catch {
        channel.nack(msg, false, false);
        return;
      }

      const supplierId = body?.supplierId;
      if (!supplierId || typeof supplierId !== 'string') {
        channel.nack(msg, false, false);
        return;
      }

      // Check message staleness if timestamp is provided
      const rawTimestamp = body?.timestamp;
      let referenceTime = new Date();
      if (rawTimestamp !== undefined && rawTimestamp !== null) {
        const parsedTime = new Date(rawTimestamp).getTime();
        if (Number.isNaN(parsedTime)) {
          channel.nack(msg, false, false);
          return;
        }

        const queueLatency = Date.now() - parsedTime;
        if (queueLatency > MAX_STALENESS_MS) {
          const staleResponse = {
            exists: false,
            isActive: false,
            isOpenNow: false,
            valid: false,
            reason: 'QUEUE_TIMEOUT_EXPIRED',
            supplier: null,
          };
          channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(staleResponse)), {
            correlationId,
          });
          channel.ack(msg);
          return;
        }

        referenceTime = new Date(parsedTime);
      }

      const s = await repository.findById(supplierId);

      const exists = !!s;
      const isActive = !!s?.isActive;
      const isCurrentlyOpen =
        !!s &&
        isOpenNow(
          s.opensAt,
          s.closesAt,
          s.isActive,
          referenceTime,
          'Asia/Singapore',
          DEFAULT_CUTOFF_BUFFER_MINUTES
        );
      const valid = exists && isActive && isCurrentlyOpen;
      const reason = !exists ? 'NOT_FOUND' : !isActive ? 'INACTIVE' : !isCurrentlyOpen ? 'CLOSED' : null;

      const response = {
        exists,
        isActive,
        isOpenNow: isCurrentlyOpen,
        valid,
        reason,
        supplier: s
          ? {
              id: s.id,
              name: s.name,
              facilityType: s.facilityType,
              building: s.building,
              floor: s.floor,
              locationDescription: s.locationDescription,
              opensAt: s.opensAt.slice(0, 5),
              closesAt: s.closesAt.slice(0, 5),
            }
          : null,
      };

      channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(response)), {
        correlationId,
      });

      channel.ack(msg);
    } catch {
      channel.nack(msg, false, false);
    }
  });
}
