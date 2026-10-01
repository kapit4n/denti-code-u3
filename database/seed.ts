/**
 * Development seed data.
 *
 * Idempotent: every insert is keyed by a fixed id and uses `onConflictDoNothing`,
 * so running the seed twice leaves the same database. It never runs against a
 * production URL — `ALLOW_PRODUCTION_SEED` must be set explicitly, because
 * seeding real patient data would be unrecoverable.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(78);
}

if (databaseUrl.includes('prod') && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  console.error('Refusing to seed a database whose URL looks like production.');
  process.exit(78);
}

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql, { casing: 'snake_case' });

try {
  const seedResult = await seedDevelopmentData(db);
  console.log(`Seed complete: ${seedResult}`);
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

/**
 * Kept as a separate function so the first migration can be generated and
 * reviewed before any data is written.
 */
async function seedDevelopmentData(database: ReturnType<typeof drizzle>): Promise<string> {
  void database;
  return 'no seed data yet (added with the first feature milestone)';
}
