/**
 * Authentication, end to end on SQLite.
 *
 * Builds the real server through `buildServer`, so the auth plugin, the session
 * repository, the scrypt hasher and the error mapping are all exercised as the
 * process runs them. The point is the boundary the other suites assume: a request
 * with no token is refused, a valid token lets it through, and login hands out a
 * token that only works for the clinic it was issued in.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { createSqliteConnection } from '../src/infrastructure/persistence/sqlite/connection.js';
import { ScryptPasswordHasher } from '../src/infrastructure/security/scrypt-password-hasher.js';
import { buildServer, type DentiApiServer } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clinicId = 'b0b0b0b0-0000-4000-8000-000000000001';
const userId = 'b0b0b0b0-0000-4000-8000-000000000002';
const PASSWORD = 'a-good-password';

describe('authentication (SQLite)', () => {
  let dir: string;
  let app: DentiApiServer;
  let productionApp: DentiApiServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'denti-auth-'));
    const databaseUrl = `sqlite:${path.join(dir, 'denti.db')}`;

    const { db, client } = createSqliteConnection(databaseUrl);
    await migrate(db, {
      migrationsFolder: path.join(here, '../../../database/migrations-sqlite'),
    });
    await seed(db);
    client.close();

    const environment = {
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '4001',
      LOG_LEVEL: 'silent',
      CORS_ORIGINS: 'http://localhost:5173',
      DATABASE_URL: databaseUrl,
      CLINIC_TIMEZONE: 'UTC',
      CLINIC_ID: clinicId,
      SESSION_TTL_HOURS: '12',
      AUTH_LOGIN_MAX_ATTEMPTS: '2',
      AUTH_LOGIN_WINDOW_MINUTES: '15',
    };

    app = await buildServer(environment);
    productionApp = await buildServer({ ...environment, NODE_ENV: 'production' });
  });

  afterAll(async () => {
    await productionApp?.close();
    await app?.close();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function login(email = 'admin@auth.test', password = PASSWORD) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
  }

  it('refuses a protected route with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/dentists' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('refuses a malformed or unknown token', async () => {
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/dentists',
      headers: { authorization: 'Basic abc' },
    });
    expect(malformed.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/dentists',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('leaves the health probe reachable without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
  });

  it('logs in with the right password and returns a bearer token', async () => {
    const response = await login();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user.email).toBe('admin@auth.test');
    // The response never carries the hash.
    expect(JSON.stringify(body)).not.toContain('scrypt$');
  });

  it('accepts the issued token on a protected route', async () => {
    const { token } = (await login()).json();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/dentists',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().items)).toBe(true);
  });

  it('refuses a wrong password and an unknown email identically', async () => {
    const wrong = await login('admin@auth.test', 'wrong');
    const unknown = await login('nobody@auth.test', PASSWORD);

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    // Same code and message: the endpoint must not reveal which accounts exist.
    expect(wrong.json().error.code).toBe('UNAUTHENTICATED');
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('is case-insensitive on the email', async () => {
    const response = await login('ADMIN@AUTH.TEST', PASSWORD);
    expect(response.statusCode).toBe(200);
  });

  it('revokes the token on logout', async () => {
    const { token } = (await login()).json();
    const auth = { authorization: `Bearer ${token}` };

    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth })).statusCode,
    ).toBe(200);

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: auth,
    });
    expect(loggedOut.statusCode).toBe(204);

    const after = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth });
    expect(after.statusCode).toBe(401);
  });

  it('answers the current user on /auth/me', async () => {
    const { token } = (await login()).json();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ email: 'admin@auth.test', role: 'ADMINISTRATOR' });
  });

  it('refuses a route the caller’s role may not use', async () => {
    // A receptionist may read patients and take payments but not write treatments.
    // The check runs before the body is read, so an empty body still answers 403
    // rather than a validation error.
    const { token } = (await login('reception@auth.test')).json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/treatments',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('throttles repeated failures without touching another account', async () => {
    const email = 'limited@auth.test';

    expect((await login(email, 'wrong')).statusCode).toBe(401);
    expect((await login(email, 'wrong')).statusCode).toBe(401);

    // Even the right password is refused while the window is exhausted — the
    // limiter runs before the credential check.
    const throttled = await login(email, PASSWORD);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe('RATE_LIMITED');
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);

    // The key includes the address and email, so a different account from the
    // same address is unaffected.
    expect((await login('admin@auth.test', PASSWORD)).statusCode).toBe(200);
  });

  it('clears the failure count after a successful sign-in', async () => {
    const email = 'resettable@auth.test';

    expect((await login(email, 'wrong')).statusCode).toBe(401);
    expect((await login(email, PASSWORD)).statusCode).toBe(200);

    // Without the reset these would be the third and fourth failures, and the
    // second would already be 429.
    expect((await login(email, 'wrong')).statusCode).toBe(401);
    expect((await login(email, 'wrong')).statusCode).toBe(401);
    expect((await login(email, PASSWORD)).statusCode).toBe(429);
  });

  it('does not expose the development doors in production', async () => {
    const users = await productionApp.inject({
      method: 'GET',
      url: '/api/v1/auth/dev-users',
    });
    const login = await productionApp.inject({
      method: 'POST',
      url: '/api/v1/auth/dev-login',
      payload: { userId },
    });

    expect(users.statusCode).toBe(404);
    expect(login.statusCode).toBe(404);
  });

  it('lists the clinic users for development without credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/dev-users' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const emails = body.items.map((user: { email: string }) => user.email);
    expect(emails).toContain('admin@auth.test');
    expect(emails).not.toContain('inactive@auth.test');
    expect(JSON.stringify(body)).not.toContain('scrypt$');
  });

  it('issues a session as a chosen user without a password', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/auth/dev-users' })).json();
    const target = list.items.find(
      (user: { email: string }) => user.email === 'reception@auth.test',
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/dev-login',
      payload: { userId: target.id },
    });

    expect(response.statusCode).toBe(200);
    const { token, user } = response.json();
    expect(user.email).toBe('reception@auth.test');

    // The token is a real session, not a dev-only bypass downstream.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('reception@auth.test');
  });

  it('refuses an inactive user and a malformed dev sign-in', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/dev-login',
      payload: { userId: 'not-a-uuid' },
    });
    expect(malformed.statusCode).toBe(422);

    const inactive = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/dev-login',
      payload: { userId: 'b0b0b0b0-0000-4000-8000-000000000007' },
    });
    expect(inactive.statusCode).toBe(401);
  });

  it('lets an administrator past the same permission check', async () => {
    // The administrator holds every permission, so the same route is reachable —
    // it then fails on the body, which proves authorization was not the obstacle.
    const { token } = (await login()).json();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/treatments',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
  });
});

async function seed(db: BetterSQLite3Database<typeof sqliteSchema>) {
  await db.insert(sqliteSchema.clinics).values({
    id: clinicId,
    name: 'Auth Clinic',
    timeZone: 'UTC',
    currencyCode: 'USD',
    isActive: true,
  });

  await db.insert(sqliteSchema.users).values({
    id: userId,
    clinicId,
    email: 'admin@auth.test',
    passwordHash: await new ScryptPasswordHasher().hash(PASSWORD),
    fullName: 'Auth Admin',
    role: 'ADMINISTRATOR',
    isActive: true,
  });

  await db.insert(sqliteSchema.users).values({
    id: 'b0b0b0b0-0000-4000-8000-000000000004',
    clinicId,
    email: 'reception@auth.test',
    passwordHash: await new ScryptPasswordHasher().hash(PASSWORD),
    fullName: 'Auth Receptionist',
    role: 'RECEPTIONIST',
    isActive: true,
  });

  await db.insert(sqliteSchema.users).values({
    id: 'b0b0b0b0-0000-4000-8000-000000000005',
    clinicId,
    email: 'limited@auth.test',
    passwordHash: await new ScryptPasswordHasher().hash(PASSWORD),
    fullName: 'Rate Limited',
    role: 'RECEPTIONIST',
    isActive: true,
  });

  await db.insert(sqliteSchema.users).values({
    id: 'b0b0b0b0-0000-4000-8000-000000000007',
    clinicId,
    email: 'inactive@auth.test',
    passwordHash: await new ScryptPasswordHasher().hash(PASSWORD),
    fullName: 'Inactive User',
    role: 'ASSISTANT',
    isActive: false,
  });

  await db.insert(sqliteSchema.users).values({
    id: 'b0b0b0b0-0000-4000-8000-000000000006',
    clinicId,
    email: 'resettable@auth.test',
    passwordHash: await new ScryptPasswordHasher().hash(PASSWORD),
    fullName: 'Resettable',
    role: 'RECEPTIONIST',
    isActive: true,
  });

  await db.insert(sqliteSchema.dentists).values({
    id: 'b0b0b0b0-0000-4000-8000-000000000003',
    clinicId,
    fullName: 'Dr Auth',
    isActive: true,
  });
}
