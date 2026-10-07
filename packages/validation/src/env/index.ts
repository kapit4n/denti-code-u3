/**
 * Environment configuration schemas.
 *
 * Configuration is validated **once, at startup**, in every runtime. A process
 * that starts with a missing or malformed variable fails immediately rather than
 * failing on the first request that needs it. No code reads `process.env` outside
 * these modules.
 */

import { z } from 'zod';
import { timeZoneSchema } from '../common/index.js';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const environmentSchema = z.enum(['development', 'test', 'production']);

/** Split `a,b , c` into a trimmed, non-empty list. */
const commaSeparatedList = z.string().transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);

/**
 * A database connection string, on either of the two supported engines.
 *
 * The engine is chosen by the URL scheme (ADR 0025): anything starting with
 * `postgres:` / `postgresql:` opens the retained PostgreSQL engine, and a
 * `sqlite:` / `file:` URL opens the default SQLite engine. Everything on the
 * API runs over SQLite unless `DATABASE_URL` says otherwise.
 *
 * `z.url()`'s `protocol` option matches the scheme *including* its trailing
 * colon, which reads well but silently rejects every real `postgres://` URL
 * under Zod 4. Validating as a URL first and then asserting the scheme
 * separately is both correct and easier to read.
 *
 * The scheme is matched with a regex rather than `new URL(...).protocol` so this
 * schema stays usable in a plain ES2023 runtime with no DOM or Node globals —
 * it runs in the browser, in Node and inside the Tauri shell.
 */
const databaseUrlSchema = z
  .url('DATABASE_URL must be a valid URL')
  .refine((value) => /^postgres(ql)?:\/\//.test(value) || /^(sqlite|file):/.test(value), {
    message: 'DATABASE_URL must be a postgres:// or sqlite:/file: URL',
  });

/**
 * A clinic id, which is a PostgreSQL UUID.
 *
 * Required — not defaulted — on purpose. Every clinical table carries
 * `clinic_id` and ADR 0014 forbids inferring the scope from global state, so a
 * process that cannot name its clinic has no valid way to answer a clinical
 * query. Failing at startup is the honest outcome; defaulting to a random or
 * zero id would silently return another clinic's rows.
 */
const clinicIdSchema = z.uuid('CLINIC_ID must be a UUID');

export const apiEnvironmentSchema = z.object({
  NODE_ENV: environmentSchema.default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3010),
  LOG_LEVEL: logLevelSchema.default('info'),
  CORS_ORIGINS: commaSeparatedList.default([]),
  DATABASE_URL: databaseUrlSchema,
  CLINIC_TIMEZONE: timeZoneSchema.default('UTC'),
  CLINIC_ID: clinicIdSchema,
});

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
});

/**
 * Vite inlines `import.meta.env` at build time, so client configuration is read
 * from there rather than from `process.env`.
 */
export const webEnvironmentSchema = z.object({
  MODE: z.string(),
  VITE_API_URL: z.url().default('http://localhost:3010'),
  VITE_APP_NAME: z.string().default('Denti-Code U3'),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;
