import { describe, it, expect, vi } from 'vitest';
import type { Channel } from 'amqplib';
import { InMemorySupplierRepository } from '../../src/db/repository.js';
import { startSupplierRpcConsumer } from '../../src/events/rpcConsumer.js';

describe('Supplier RPC Consumer (Seam B)', () => {
  const createMockChannel = () => ({
    assertQueue: vi.fn().mockResolvedValue({ queue: 'supplier.rpc.validate', messageCount: 0, consumerCount: 0 }),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'test-consumer-tag' }),
    sendToQueue: vi.fn().mockReturnValue(true),
    ack: vi.fn(),
    nack: vi.fn(),
  });

  describe('Slice 1: Queue declaration & consumer setup', () => {
    it('asserts durable queue supplier.rpc.validate and starts consuming', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('supplier.rpc.validate', { durable: true });
      expect(mockChannel.consume).toHaveBeenCalledWith('supplier.rpc.validate', expect.any(Function));
    });
  });

  describe('Slice 2: Valid open supplier request', () => {
    it('replies with valid: true, snapshot data, and matching correlationId', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      const created = await repo.create({
        name: 'The Deck Pasta & Western',
        facilityType: 'Food',
        building: 'The Deck',
        floor: '2',
        locationDescription: 'Renovated Stall 5 near LT27',
        latitude: null,
        longitude: null,
        opensAt: '00:00',
        closesAt: '23:59',
        imageUrl: null,
      });

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: created.id })),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-2-test-corr-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [replyQueue, replyContent, replyOptions] = mockChannel.sendToQueue.mock.calls[0];
      expect(replyQueue).toBe('amq.rabbitmq.reply-to');
      expect(replyOptions).toEqual({ correlationId: 'slice-2-test-corr-id' });

      const parsed = JSON.parse(replyContent.toString());
      expect(parsed).toEqual({
        exists: true,
        isActive: true,
        isOpenNow: true,
        valid: true,
        reason: null,
        supplier: {
          id: created.id,
          name: 'The Deck Pasta & Western',
          facilityType: 'Food',
          building: 'The Deck',
          floor: '2',
          locationDescription: 'Renovated Stall 5 near LT27',
          opensAt: '00:00',
          closesAt: '23:59',
        },
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('Slice 3: Non-existent supplier request', () => {
    it('replies with valid: false, exists: false, reason: NOT_FOUND, and supplier: null', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: 'non-existent-id' })),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-3-test-corr-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [replyQueue, replyContent, replyOptions] = mockChannel.sendToQueue.mock.calls[0];
      expect(replyQueue).toBe('amq.rabbitmq.reply-to');
      expect(replyOptions).toEqual({ correlationId: 'slice-3-test-corr-id' });

      const parsed = JSON.parse(replyContent.toString());
      expect(parsed).toEqual({
        exists: false,
        isActive: false,
        isOpenNow: false,
        valid: false,
        reason: 'NOT_FOUND',
        supplier: null,
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('Slice 4: Deactivated supplier request', () => {
    it('replies with valid: false, exists: true, isActive: false, reason: INACTIVE, and supplier snapshot', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      const created = await repo.create({
        name: 'Techno Edge Western',
        facilityType: 'Food',
        building: 'Techno Edge',
        floor: '1',
        locationDescription: 'Stall 4',
        latitude: null,
        longitude: null,
        opensAt: '00:00',
        closesAt: '23:59',
        imageUrl: null,
      });

      await repo.setActive(created.id, false);

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: created.id })),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-4-test-corr-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [replyQueue, replyContent, replyOptions] = mockChannel.sendToQueue.mock.calls[0];
      expect(replyQueue).toBe('amq.rabbitmq.reply-to');
      expect(replyOptions).toEqual({ correlationId: 'slice-4-test-corr-id' });

      const parsed = JSON.parse(replyContent.toString());
      expect(parsed).toEqual({
        exists: true,
        isActive: false,
        isOpenNow: false,
        valid: false,
        reason: 'INACTIVE',
        supplier: {
          id: created.id,
          name: 'Techno Edge Western',
          facilityType: 'Food',
          building: 'Techno Edge',
          floor: '1',
          locationDescription: 'Stall 4',
          opensAt: '00:00',
          closesAt: '23:59',
        },
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('Slice 5: Closed supplier request', () => {
    it('replies with valid: false, exists: true, isActive: true, isOpenNow: false, reason: CLOSED, and supplier snapshot', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      const created = await repo.create({
        name: 'Late Supper Stall',
        facilityType: 'Food',
        building: 'UTown',
        floor: '2',
        locationDescription: 'Late supper',
        latitude: null,
        longitude: null,
        opensAt: '03:00',
        closesAt: '04:00',
        imageUrl: null,
      });

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: created.id })),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-5-test-corr-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [replyQueue, replyContent, replyOptions] = mockChannel.sendToQueue.mock.calls[0];
      expect(replyQueue).toBe('amq.rabbitmq.reply-to');
      expect(replyOptions).toEqual({ correlationId: 'slice-5-test-corr-id' });

      const parsed = JSON.parse(replyContent.toString());
      expect(parsed).toEqual({
        exists: true,
        isActive: true,
        isOpenNow: false,
        valid: false,
        reason: 'CLOSED',
        supplier: {
          id: created.id,
          name: 'Late Supper Stall',
          facilityType: 'Food',
          building: 'UTown',
          floor: '2',
          locationDescription: 'Late supper',
          opensAt: '03:00',
          closesAt: '04:00',
        },
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('Slice 6: Error boundaries & poison pill handling', () => {
    it('rejects malformed JSON with nack(msg, false, false) without crashing or replying', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from('invalid-json{{{'),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-6-malformed-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });

    it('rejects message missing replyTo with nack(msg, false, false) without attempting to reply', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: 'some-id' })),
        properties: {
          replyTo: undefined,
          correlationId: 'slice-6-no-replyto-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });
  });

  describe('Slice 7: Message staleness / queue latency validation', () => {
    it('replies with valid: false, reason: QUEUE_TIMEOUT_EXPIRED when queue latency exceeds 60 seconds', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();
      const findByIdSpy = vi.spyOn(repo, 'findById');

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      // Message created 65 seconds ago
      const staleTimestamp = new Date(Date.now() - 65_000).toISOString();
      const mockMsg = {
        content: Buffer.from(JSON.stringify({ supplierId: 'some-id', timestamp: staleTimestamp })),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-7-stale-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(findByIdSpy).not.toHaveBeenCalled();
      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [replyQueue, replyContent, replyOptions] = mockChannel.sendToQueue.mock.calls[0];
      expect(replyQueue).toBe('amq.rabbitmq.reply-to');
      expect(replyOptions).toEqual({ correlationId: 'slice-7-stale-id' });

      const parsed = JSON.parse(replyContent.toString());
      expect(parsed).toEqual({
        exists: false,
        isActive: false,
        isOpenNow: false,
        valid: false,
        reason: 'QUEUE_TIMEOUT_EXPIRED',
        supplier: null,
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    });
  });

  describe('Slice 8: Store cutoff window enforcement', () => {
    it('rejects order submitted within 15-minute cutoff buffer even if stall is currently active', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      const created = await repo.create({
        name: 'The Deck Cutoff Test Stall',
        facilityType: 'Food',
        building: 'The Deck',
        floor: '2',
        locationDescription: 'Stall 6',
        latitude: null,
        longitude: null,
        opensAt: '09:00',
        closesAt: '21:30',
        imageUrl: null,
      });

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];

      // 1. Order timestamp at 21:16 SGT (13:16 UTC) -> within 15 min cutoff of 21:30 -> CLOSED
      // Note: use recent Date so staleness check passes
      const now = Date.now();
      // Mock Date.now to freeze current time around the test timestamp to prevent staleness triggering
      vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-24T13:16:05Z').getTime());

      const cutoffMsg = {
        content: Buffer.from(
          JSON.stringify({
            supplierId: created.id,
            timestamp: '2026-09-24T13:16:00Z', // 21:16 SGT
          })
        ),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-8-cutoff-corr-id',
        },
      };

      await consumerCallback(cutoffMsg);

      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
      const [, replyContent] = mockChannel.sendToQueue.mock.calls[0];
      const parsed = JSON.parse(replyContent.toString());

      expect(parsed).toEqual({
        exists: true,
        isActive: true,
        isOpenNow: false,
        valid: false,
        reason: 'CLOSED',
        supplier: {
          id: created.id,
          name: 'The Deck Cutoff Test Stall',
          facilityType: 'Food',
          building: 'The Deck',
          floor: '2',
          locationDescription: 'Stall 6',
          opensAt: '09:00',
          closesAt: '21:30',
        },
      });

      expect(mockChannel.ack).toHaveBeenCalledWith(cutoffMsg);
      vi.restoreAllMocks();
    });
  });

  describe('Slice 9: Invalid timestamp handling', () => {
    it('safely rejects message with unparseable timestamp using nack(msg, false, false)', async () => {
      const mockChannel = createMockChannel();
      const repo = new InMemorySupplierRepository();

      await startSupplierRpcConsumer(mockChannel as unknown as Channel, repo);

      const consumerCallback = mockChannel.consume.mock.calls[0][1];
      const mockMsg = {
        content: Buffer.from(
          JSON.stringify({
            supplierId: 'some-id',
            timestamp: 'not-a-valid-iso-date',
          })
        ),
        properties: {
          replyTo: 'amq.rabbitmq.reply-to',
          correlationId: 'slice-9-invalid-timestamp-id',
        },
      };

      await consumerCallback(mockMsg);

      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
      expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
    });
  });
});
