import { z } from 'zod';
import { paginationSchema } from '@foc/shared-middleware';

const time = (label: string) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} must be in 24-hour HH:MM format, e.g. 09:00.`);

const supplierFields = {
  name: z.string({ required_error: 'Name is required.' }).trim().min(1, 'Name is required.').max(100, 'Name must be at most 100 characters.'),
  facilityType: z.string({ required_error: 'Facility type is required.' }).trim().min(1, 'Facility type is required.').max(50),
  building: z.string({ required_error: 'Building is required.' }).trim().min(1, 'Building is required.').max(100),
  floor: z.string().trim().max(10, 'Floor must be at most 10 characters.').transform((s) => (s === '' ? null : s)).nullable().optional(),
  locationDescription: z.string().trim().max(300, 'Location description must be at most 300 characters.').optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  opensAt: time('Opening time'),
  closesAt: time('Closing time'),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10, 'At most 10 tags.').optional(),
};

const hoursDiffer = (v: { opensAt?: string; closesAt?: string }) => !v.opensAt || !v.closesAt || v.opensAt !== v.closesAt;
const hoursMessage = { message: 'Opening and closing times cannot be the same.', path: ['closesAt'] };

/** F8.1: create. isActive is not settable here; use the deactivate/reactivate endpoints. */
export const createSupplierSchema = z.object(supplierFields).strict().refine(hoursDiffer, hoursMessage);

/** F9.3: update any subset of fields. */
export const updateSupplierSchema = z
  .object({
    name: supplierFields.name.optional(),
    facilityType: supplierFields.facilityType.optional(),
    building: supplierFields.building.optional(),
    floor: supplierFields.floor,
    locationDescription: supplierFields.locationDescription,
    latitude: supplierFields.latitude,
    longitude: supplierFields.longitude,
    opensAt: supplierFields.opensAt.optional(),
    closesAt: supplierFields.closesAt.optional(),
    tags: supplierFields.tags,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' })
  .refine(hoursDiffer, hoursMessage);

/** F7.2 filter, F7.3 sort, NFR7.4-7.5 pagination (max 50 per page). */
export const listQuerySchema = paginationSchema(50).extend({
  search: z.string().trim().max(100).optional(),
  facilityType: z.string().trim().max(200).optional(), // comma-separated for several
  building: z.string().trim().max(100).optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  status: z.enum(['active', 'inactive', 'all', 'open_now']).default('active'),
  sort: z.enum(['name', 'location', 'facilityType']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const bulkDeleteQuerySchema = z
  .object({
    facilityType: z.string({ required_error: 'facilityType is required for bulk delete.' }).trim().min(1),
    confirm: z.literal('true', { errorMap: () => ({ message: 'Add confirm=true to delete every supplier of this type.' }) }),
  })
  .strict();

export const idParamSchema = z.object({ id: z.string().uuid('Not a valid supplier id.') });
