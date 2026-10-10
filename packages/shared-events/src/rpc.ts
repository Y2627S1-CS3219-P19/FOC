import { randomUUID } from 'node:crypto';
import type { Channel, ConsumeMessage } from 'amqplib';

export const RPC_QUEUES = {
  supplierValidate: 'supplier.rpc.validate',
} as const;

export interface SupplierValidateRequest {
  supplierId: string;
  /**
   * ISO 8601 string or epoch ms timestamp set by order-service at checkout creation.
   * RPC verification is designed to be instantaneous (<50ms).
   * Messages exceeding 60s queue latency are rejected as QUEUE_TIMEOUT_EXPIRED.
   */
  timestamp?: string | number;
}

export interface SupplierSnapshot {
  id: string;
  name: string;
  facilityType: string;
  building: string;
  floor: string | null;
  locationDescription: string | null;
  opensAt: string;
  closesAt: string;
}

export interface SupplierValidateResponse {
  valid: boolean;
  exists: boolean;
  isActive: boolean;
  isOpenNow: boolean;
  reason: 'NOT_FOUND' | 'INACTIVE' | 'CLOSED' | 'QUEUE_TIMEOUT_EXPIRED' | null;
  supplier: SupplierSnapshot | null;
}

export interface SupplierRpcClientOptions {
  timeoutMs?: number;
}

/**
 * Creates an RPC client for supplier verification using RabbitMQ Direct Reply-To (amq.rabbitmq.reply-to).
 */
export function createSupplierRpcClient(channel: Channel, defaultOptions: SupplierRpcClientOptions = {}) {
  const defaultTimeoutMs = defaultOptions.timeoutMs ?? 5000;

  return {
    async validateSupplier(
      request: SupplierValidateRequest,
      options: SupplierRpcClientOptions = {}
    ): Promise<SupplierValidateResponse> {
      const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
      const correlationId = randomUUID();
      const replyQueue = 'amq.rabbitmq.reply-to';

      // Ensure timestamp is stamped if omitted
      const outgoingPayload: SupplierValidateRequest = {
        supplierId: request.supplierId,
        timestamp: request.timestamp ?? new Date().toISOString(),
      };

      return new Promise<SupplierValidateResponse>((resolve, reject) => {
        let consumerTag: string | null = null;
        let timer: NodeJS.Timeout | null = null;

        const cleanup = async () => {
          if (timer) clearTimeout(timer);
          if (consumerTag) {
            try {
              await channel.cancel(consumerTag);
            } catch {
              // Ignore cancellation errors on closed channels
            }
          }
        };

        timer = setTimeout(async () => {
          await cleanup();
          reject(new Error(`Supplier RPC request timed out after ${timeoutMs}ms for supplier ${request.supplierId}`));
        }, timeoutMs);

        channel
          .consume(
            replyQueue,
            async (msg: ConsumeMessage | null) => {
              if (!msg) return;
              if (msg.properties.correlationId === correlationId) {
                await cleanup();
                try {
                  const parsed = JSON.parse(msg.content.toString()) as SupplierValidateResponse;
                  resolve(parsed);
                } catch (err) {
                  reject(new Error(`Failed to parse supplier RPC response: ${(err as Error).message}`));
                }
              }
            },
            { noAck: true }
          )
          .then((consumeResult) => {
            consumerTag = consumeResult.consumerTag;
            channel.sendToQueue(
              RPC_QUEUES.supplierValidate,
              Buffer.from(JSON.stringify(outgoingPayload)),
              {
                correlationId,
                replyTo: replyQueue,
                persistent: true,
              }
            );
          })
          .catch(async (err) => {
            await cleanup();
            reject(err);
          });
      });
    },
  };
}
