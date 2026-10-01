/**
 * Creates the integration database if it does not exist.
 *
 * `docker compose down -v` destroys the volume and with it the test database,
 * so a test suite that assumes the database is already there fails with
 * "database does not exist" — a confusing error for something that is really a
 * missing setup step. This runs as Vitest's global setup and does the step.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;

function splitDatabaseName(url: string): { adminUrl: string; databaseName: string } {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (!databaseName) {
    throw new Error(`TEST_DATABASE_URL has no database name: ${url}`);
  }

  // `CREATE DATABASE` cannot run from inside the target database, so this
  // connects to `postgres` — the one database a fresh cluster always has.
  parsed.pathname = '/postgres';

  return { adminUrl: parsed.toString(), databaseName };
}

export async function setup(): Promise<void> {
  if (!databaseUrl) {
    // No test database configured: the integration suite skips itself.
    return;
  }

  const { adminUrl, databaseName } = splitDatabaseName(databaseUrl);
  const postgres = (await import('postgres')).default;
  const sql = postgres(adminUrl, { max: 1 });

  try {
    const existing = await sql<{ exists: boolean }[]>`
      select exists (select 1 from pg_database where datname = ${databaseName}) as exists
    `;

    if (!existing[0]?.exists) {
      // Identifier cannot be parameterised; the name comes from our own .env
      // and is quoted so it is a literal, not an expression.
      await sql.unsafe(`create database ${quoteIdentifier(databaseName)}`);
      console.log(`Created integration database "${databaseName}".`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
