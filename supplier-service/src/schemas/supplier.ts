import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeSchema = (fieldName: string) =>
  z
    .string({ required_error: `${fieldName} is required` })
    .trim()
    .regex(timeRegex, `${fieldName} must be in 24-hour HH:MM format (e.g. 09:00)`);

const allowedKeys = new Set([
  'name',
  'facilityType',
  'building',
  'floor',
  'locationDescription',
  'latitude',
  'longitude',
  'opensAt',
  'closesAt',
  'imageUrl',
]);

const disallowUnknownKeys = (val: Record<string, unknown>, ctx: z.RefinementCtx) => {
  for (const key of Object.keys(val)) {
    if (!allowedKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This field is not allowed.',
        path: [key],
      });
    }
  }
};

const hoursDiffer = (val: { opensAt?: string; closesAt?: string }) => {
  if (val.opensAt && val.closesAt && val.opensAt === val.closesAt) {
    return false;
  }
  return true;
};

const hoursErrorMessage = {
  message: 'Opening and closing times cannot be the same',
  path: ['closesAt'],
};

export const createSupplierSchema = z
  .object({
    name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100),
    facilityType: z.string({ required_error: 'Facility type is required' }).trim().min(1).max(50),
    building: z.string({ required_error: 'Building is required' }).trim().min(1).max(100),
    floor: z.string().trim().max(10).nullable().optional(),
    locationDescription: z.string().trim().max(300).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    opensAt: timeSchema('Opening time'),
    closesAt: timeSchema('Closing time'),
    imageUrl: z.string().trim().max(500).nullable().optional(),
  })
  .passthrough()
  .superRefine(disallowUnknownKeys)
  .refine(hoursDiffer, hoursErrorMessage);

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    facilityType: z.string().trim().min(1).max(50).optional(),
    building: z.string().trim().min(1).max(100).optional(),
    floor: z.string().trim().max(10).nullable().optional(),
    locationDescription: z.string().trim().max(300).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    opensAt: z.string().trim().regex(timeRegex).optional(),
    closesAt: z.string().trim().regex(timeRegex).optional(),
    imageUrl: z.string().trim().max(500).nullable().optional(),
  })
  .passthrough()
  .superRefine(disallowUnknownKeys)
  .refine((val) => Object.keys(val).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(hoursDiffer, hoursErrorMessage);

export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  facilityType: z.string().trim().optional(),
  building: z.string().trim().optional(),
  status: z.enum(['active', 'open_now', 'inactive', 'all']).default('active'),
  sort: z.enum(['name', 'location', 'facilityType']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid supplier UUID'),
});

export const bulkDeleteQuerySchema = z.object({
  facilityType: z.string().trim().min(1, 'facilityType query parameter is required'),
  confirm: z.literal('true', {
    errorMap: () => ({ message: 'confirm=true is required for bulk delete' }),
  }),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
