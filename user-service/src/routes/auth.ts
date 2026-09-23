import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError, parseOrThrow } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { provisionUser } from '../provisioning.js';
import { registerSchema } from '../schemas.js';
import { toProfile } from '../users.js';

/**
 * Public routes. Login, logout, email verification and password reset are NOT here: they are Keycloak's own pages
 * (the web app redirects there). Sign-up goes through us so the NUS-email and other rules are enforced server-side.
 */
export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const schema = registerSchema(ctx.config.allowedEmailDomains);

  // F1.1.4: at most N account creations per IP per hour (in-memory; per instance).
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: ctx.config.registerRateLimitPerHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many sign-up attempts from this network. Please try again later.')),
  });

  router.post('/register', registerLimiter, async (req, res) => {
    const body = parseOrThrow(schema, req.body, 'Please fix the highlighted fields.');
    const user = await provisionUser(ctx, {
      username: body.username,
      email: body.email,
      password: body.password,
      role: 'user', // F1.1.7: never taken from the request
      temporaryPassword: false,
      emailVerified: false,
      sendVerificationEmail: true,
      correlationId: req.correlationId,
    });
    res.status(201).json({
      data: {
        user: toProfile(user),
        nextStep: 'VERIFY_EMAIL',
        message: `Account created. We sent a verification link to ${user.email}. Verify your email, then log in.`,
      },
    });
  });

  return router;
}
