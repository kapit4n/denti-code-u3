/**
 * Authentication wire schemas.
 *
 * `loginSchema` is the only thing a caller sends: an email and a password. The
 * password is not trimmed and not length-capped here beyond a sane maximum — a
 * person's password may contain spaces, and a silent trim would make a password
 * that verified once stop verifying. The minimum is enforced by the use case, not
 * the schema, because "wrong shape" and "wrong password" must produce the same
 * refusal and a schema failure would produce a different one.
 */

import { z } from 'zod';

import { emailSchema } from '../common/index.js';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

export type LoginBody = z.infer<typeof loginSchema>;

/**
 * The authenticated caller, as returned to a client.
 *
 * No password hash, ever: the shape a route sends is this one, and it has no
 * field the hash could hide in.
 */
export const authenticatedUserSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['ADMINISTRATOR', 'DENTIST', 'ASSISTANT', 'RECEPTIONIST']),
  isActive: z.boolean(),
  lastLoginAt: z.string().optional(),
});

export const loginResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: authenticatedUserSchema,
});

export const sessionResponseSchema = z.object({
  user: authenticatedUserSchema,
  expiresAt: z.string(),
});
