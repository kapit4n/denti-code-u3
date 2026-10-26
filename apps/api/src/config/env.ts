/**
 * API configuration — the only place in `apps/api` that reads `process.env`.
 *
 * Configuration is validated once, at startup. A process with a missing or
 * malformed variable refuses to boot rather than failing on the first request
 * that needs it, which turns a runtime 500 into an immediate, readable error.
 */

import { z } from 'zod';
import { apiEnvironmentSchema, type ApiEnvironment } from '@denti-code-u3/validation';

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly logPretty: boolean;
  readonly corsOrigins: readonly string[];
  readonly databaseUrl: string;
  readonly clinicTimeZone: string;
  /**
   * The clinic this process serves.
   *
   * A session must belong to this clinic, so a token issued for another clinic is
   * refused (ADR 0028). The value still lives only at the HTTP edge: repositories
   * and use cases keep receiving `clinicId` as an explicit argument.
   */
  readonly clinicId: string;
  /** Session lifetime in hours. See `apiEnvironmentSchema`. */
  readonly sessionTtlHours: number;
  /** Failed logins allowed per email and address in the window below. */
  readonly loginMaxAttempts: number;
  /** The rate-limit window, in minutes. */
  readonly loginWindowMinutes: number;
}

export type EnvSource = Record<string, string | undefined>;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n  - ${issues.join('\n  - ')}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export function loadApiConfig(env: EnvSource = process.env): ApiConfig {
  const parsed = apiEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigurationError(formatIssues(parsed.error));
  }

  const value: ApiEnvironment = parsed.data;
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    host: value.API_HOST,
    port: value.API_PORT,
    logLevel: value.LOG_LEVEL,
    // Human-readable logs locally, JSON logs everywhere else.
    logPretty: value.NODE_ENV === 'development' && value.LOG_LEVEL !== 'silent',
    corsOrigins: value.CORS_ORIGINS,
    databaseUrl: value.DATABASE_URL,
    clinicTimeZone: value.CLINIC_TIMEZONE,
    clinicId: value.CLINIC_ID,
    sessionTtlHours: value.SESSION_TTL_HOURS,
    loginMaxAttempts: value.AUTH_LOGIN_MAX_ATTEMPTS,
    loginWindowMinutes: value.AUTH_LOGIN_WINDOW_MINUTES,
  });
}

export const apiConfigSchemaForTesting = z.object({
  DATABASE_URL: z.string(),
});

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
