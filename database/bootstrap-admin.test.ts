import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@denti-code-u3/database/schema/sqlite';
import { sqliteDatabasePath } from './db-url.js';
import { bootstrapAdmin, parseBootstrapArgs } from './bootstrap-admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clinicId = '33333333-3333-4333-8333-333333333333';

describe('bootstrapAdmin', () => {
  let dir: string;
  let databaseUrl: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'denti-bootstrap-'));
    databaseUrl = `sqlite:${path.join(dir, 'denti.db')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('CLINIC_ID', clinicId);
    vi.stubEnv('CLINIC_NAME', 'Bootstrap Clinic');
    vi.stubEnv('CLINIC_TIMEZONE', 'UTC');
    vi.stubEnv('CLINIC_CURRENCY', 'USD');

    const client = new Database(sqliteDatabasePath(databaseUrl));
    const db = drizzle(client, { schema, casing: 'snake_case' });
    await migrate(db, { migrationsFolder: path.join(here, 'migrations-sqlite') });
    client.close();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the clinic and one administrator when the clinic is empty', async () => {
    const result = await bootstrapAdmin({
      email: 'owner@clinic.test',
      password: 'a-strong-password',
      fullName: 'Clinic Owner',
    });

    expect(result).toEqual({
      clinicId,
      userId: expect.any(String),
      email: 'owner@clinic.test',
    });

    const client = new Database(sqliteDatabasePath(databaseUrl));
    const db = drizzle(client, { schema, casing: 'snake_case' });
    const clinics = await db.select().from(schema.clinics);
    const users = await db.select().from(schema.users);
    client.close();

    expect(clinics).toHaveLength(1);
    expect(clinics[0]).toMatchObject({
      id: clinicId,
      name: 'Bootstrap Clinic',
      timeZone: 'UTC',
      currencyCode: 'USD',
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: result.userId,
      clinicId,
      email: 'owner@clinic.test',
      fullName: 'Clinic Owner',
      role: 'ADMINISTRATOR',
      isActive: true,
    });
    expect(users[0]?.passwordHash).toMatch(/^scrypt\$/);
  });

  it('refuses to bootstrap a clinic that already has a user', async () => {
    await bootstrapAdmin({ email: 'first@clinic.test', password: 'a-strong-password' });
    await expect(
      bootstrapAdmin({ email: 'second@clinic.test', password: 'another-strong-password' }),
    ).rejects.toThrow(/already has users/);
  });

  it('rejects short passwords and unknown flags before touching the database', () => {
    expect(() =>
      parseBootstrapArgs(['--email', 'owner@clinic.test', '--password', 'short']),
    ).toThrow(/Invalid bootstrap arguments/);
    expect(() => parseBootstrapArgs(['--password-file', 'secret.txt'])).toThrow(/Unknown argument/);
  });
});
