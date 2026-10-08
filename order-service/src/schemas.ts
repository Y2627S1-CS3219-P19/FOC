import { z } from 'zod';
import { paginationSchema } from '@foc/shared-middleware';
import { ORDER_STATUSES } from './domain/order.js';

export const createOrderSchema = z
  .object({
    supplierId: z.string({ required_error: 'Supplier is required.' }).uuid('Not a valid supplier id.'),
    deliveryLocation: z
      .string({ required_error: 'Delivery location is required.' })
      .trim()
      .min(1, 'Delivery location is required.')
      .max(200, 'Delivery location must be at most 200 characters.'),
    items: z
      .array(z.string().trim().min(1, 'Item cannot be empty.').max(200, 'Item must be at most 200 characters.'), {
        required_error: 'Add at least one item.',
      })
      .min(1, 'Add at least one item.')
      .max(20, 'At most 20 items.'),
    creditAmount: z
      .number({ required_error: 'Credit amount is required.' })
      .int('Credit amount must be a whole number.')
      .positive('Credit amount must be more than 0.')
      .max(1000, 'Credit amount must be at most 1000.'),
    expiresAt: z
      .string({ required_error: 'Expiry time is required.' })
      .datetime({ offset: true, message: 'Expiry must be an ISO 8601 date-time.' }),
  })
  .strict();

const minutes = z.coerce.number().int().min(0).optional();
const credits = z.coerce.number().int().min(0).optional();

export const listOpenQuerySchema = paginationSchema(50)
  .extend({
    supplierId: z.string().uuid().optional(),
    building: z.string().trim().max(100).optional(),
    facilityType: z.string().trim().max(50).optional(),
    deliveryLocation: z.string().trim().max(200).optional(),
    minCredit: credits,
    maxCredit: credits,
    minRemainingMinutes: minutes,
    maxRemainingMinutes: minutes,
    sort: z.enum(['expiry', 'credit']).default('expiry'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const mineQuerySchema = paginationSchema(50)
  .extend({
    as: z.enum(['requester', 'runner']).default('requester'),
    status: z.enum(ORDER_STATUSES).optional(),
  })
  .strict();

export const byUserQuerySchema = paginationSchema(50)
  .extend({ status: z.enum(ORDER_STATUSES).optional() })
  .strict();

export const idParamSchema = z.object({ id: z.string().uuid('Not a valid order id.') });
export const userIdParamSchema = z.object({ userId: z.string().uuid('Not a valid user id.') });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOpenQuery = z.infer<typeof listOpenQuerySchema>;
export type MineQuery = z.infer<typeof mineQuerySchema>;
export type ByUserQuery = z.infer<typeof byUserQuerySchema>;
