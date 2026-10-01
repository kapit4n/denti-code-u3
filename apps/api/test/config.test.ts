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
};

describe('loadApiConfig', () => {
  it('maps a valid environment into a frozen config', () => {
    const config = loadApiConfig(VALID_ENV);

    expect(config.nodeEnv).toBe('test');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4000);
    expect(config.clinicTimeZone).toBe('America/Argentina/Buenos_Aires');
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:5174']);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('refuses to boot without a DATABASE_URL', () => {
    const withoutDatabase: EnvSource = { ...VALID_ENV, DATABASE_URL: undefined };

    expect(() => loadApiConfig(withoutDatabase)).toThrow(ConfigurationError);
  });

  it('rejects a non-PostgreSQL connection string', () => {
    expect(() => loadApiConfig({ ...VALID_ENV, DATABASE_URL: 'mysql://host/db' })).toThrow(
      /DATABASE_URL must be a PostgreSQL connection string/,
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
