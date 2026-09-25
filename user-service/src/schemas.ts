import { z } from 'zod';
import { paginationSchema } from '@foc/shared-middleware';

/**
 * Sign-up (F1.1-F1.1.7). `.strict()` rejects any extra field, so a body with "role": "admin" is refused (422)
 * instead of silently ignored. Keycloak re-checks the password policy and the @u.nus.edu pattern as a backstop.
 */
export function registerSchema(allowedDomains: string[]) {
  const domains = allowedDomains.map((d) => `@${d}`).join(' or ');
  return z
    .object({
      username: z
        .string({ required_error: 'Username is required.' })
        .trim()
        .min(3, 'Username must be at least 3 characters.')
        .max(30, 'Username must be at most 30 characters.')
        .regex(/^[a-zA-Z0-9._-]+$/, 'Use only letters, numbers, dots, dashes or underscores.')
        .transform((s) => s.toLowerCase()),
      email: z
        .string({ required_error: 'Email is required.' })
        .trim()
        .toLowerCase()
        .email('Enter a valid email address.')
        .refine((e) => allowedDomains.includes(e.split('@')[1] ?? ''), `Only ${domains} email addresses are allowed.`),
      password: z
        .string({ required_error: 'Password is required.' })
        .min(8, 'Password must be at least 8 characters.')
        .max(128, 'Password must be at most 128 characters.')
        .regex(/[A-Z]/, 'Password needs at least one uppercase letter.')
        .regex(/[a-z]/, 'Password needs at least one lowercase letter.')
        .regex(/[0-9]/, 'Password needs at least one digit.'),
      confirmPassword: z.string({ required_error: 'Please confirm your password.' }),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.password !== v.confirmPassword) {
        ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match.' });
      }
    });
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

/**
 * Profile update whitelist (F4.1, D2 Part 1 #5). Only these three fields can ever be changed by the owner.
 * role, status, id, email, username and rating are NOT in the schema, and .strict() makes them a 422.
 */
export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Display name cannot be empty.').max(50, 'Display name must be at most 50 characters.').optional(),
    contactNumber: z
      .string()
      .trim()
      .regex(/^(\+?\d[\d -]{6,18}\d)?$/, 'Enter a valid phone number, e.g. +65 9123 4567.')
      .transform((s) => (s === '' ? null : s))
      .nullable()
      .optional(),
    defaultDeliveryLocation: optionalText(200, 'Default delivery location'),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export const adminUserQuerySchema = paginationSchema(100).extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  role: z.enum(['user', 'admin']).optional(),
});

export const suspendSchema = z
  .object({
    reason: z.string({ required_error: 'A reason is required.' }).trim().min(3, 'Give a reason of at least 3 characters.').max(500),
  })
  .strict();

export const roleChangeRequestSchema = z
  .object({
    targetUserId: z.string().uuid('targetUserId must be a user id.'),
    newRole: z.enum(['user', 'admin'], { message: "newRole must be 'user' or 'admin'." }),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const roleChangeQuerySchema = paginationSchema(100).extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export const auditQuerySchema = paginationSchema(100).extend({
  action: z.string().trim().max(50).optional(),
  adminId: z.string().uuid().optional(),
  targetId: z.string().trim().max(100).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid('Not a valid id.') });

export const introspectSchema = z.object({ token: z.string().min(10) }).strict();
