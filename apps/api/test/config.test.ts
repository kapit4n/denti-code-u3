import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadApiConfig, type EnvSource } from '../src/config/env.js';

const VALID_ENV: EnvSource = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: '4000',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174',
  DATABASE_URL: 'postgres://denti:denti_dev_password@localhost:5433/denti_code_u3',
  CLINIC_TIMEZONE: 'America/Argentina/Buenos_Aires',
  CLINIC_ID: '11111111-1111-4111-8111-111111111111',
};

describe('loadApiConfig', () => {
  it('maps a valid environment into a frozen config', () => {
    const config = loadApiConfig(VALID_ENV);

    expect(config.nodeEnv).toBe('test');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4000);
    expect(config.clinicTimeZone).toBe('America/Argentina/Buenos_Aires');
    expect(config.clinicId).toBe('11111111-1111-4111-8111-111111111111');
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to boot without a DATABASE_URL', () => {
    const withoutDatabase: EnvSource = { ...VALID_ENV, DATABASE_URL: undefined };

    expect(() => loadApiConfig(withoutDatabase)).toThrow(ConfigurationError);
  });

  it('refuses to boot without a CLINIC_ID', () => {
    // Every clinical row is scoped by clinic, and ADR 0014 forbids inferring the
    // scope from global state, so an unscoped API must fail to start rather than
    // serve whichever clinic it happens to find first.
    const withoutClinic: EnvSource = { ...VALID_ENV, CLINIC_ID: undefined };

    expect(() => loadApiConfig(withoutClinic)).toThrow(ConfigurationError);
  });

  it('rejects a CLINIC_ID that is not a UUID', () => {
    expect(() => loadApiConfig({ ...VALID_ENV, CLINIC_ID: 'not-a-uuid' })).toThrow(/CLINIC_ID/);
  });

  it('rejects a connection string for a database that is not PostgreSQL or SQLite', () => {
    // ADR 0025: two engines, no third. A `mysql://` URL is not a typo a caller
    // ever makes, so refusing it at boot is what catches the drift silently.
    expect(() => loadApiConfig({ ...VALID_ENV, DATABASE_URL: 'mysql://host/db' })).toThrow(
      /DATABASE_URL must be a postgres:\/\/ or sqlite:\/file: URL/,
    );
  });

  it('rejects an out-of-range port instead of binding to it later', () => {
    expect(() => loadApiConfig({ ...VALID_ENV, API_PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('pretty-prints only in development', () => {
    expect(
      loadApiConfig({ ...VALID_ENV, NODE_ENV: 'development', LOG_LEVEL: 'debug' }).logPretty,
    ).toBe(true);
    expect(
      loadApiConfig({ ...VALID_ENV, NODE_ENV: 'production', LOG_LEVEL: 'debug' }).logPretty,
    ).toBe(false);
    // A silenced log must stay silenced even locally.
    expect(
      loadApiConfig({ ...VALID_ENV, NODE_ENV: 'development', LOG_LEVEL: 'silent' }).logPretty,
    ).toBe(false);
  });
});
