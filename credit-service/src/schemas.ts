import { z } from 'zod';

export const walletHistoryQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(['ISSUANCE', 'RESERVE', 'SETTLE_DEBIT', 'SETTLE_CREDIT', 'RELEASE']).optional(),
});

export const reservationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['HELD', 'SETTLED', 'RELEASED']).optional(),
});

export const userIdParam = z.object({
  userId: z.string().uuid(),
});

export const reserveBody = z.object({
  orderId: z.string().uuid(),
  requesterId: z.string().uuid(),
  amount: z.coerce.number().int().positive(),
}).strict();

export const adjustmentBody = z.object({
  userId: z.string().uuid(),
  amount: z.coerce.number().int(),
  reason: z.string().min(1),
}).strict();

export const balanceAtQuery = z.object({
  ts: z.string().datetime(),
});
