import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import * as pgSchema from '@denti-code-u3/database/schema';
import * as sqliteSchema from '@denti-code-u3/database/schema/sqlite';
import { ensureSqliteDatabaseDirectory, isSqliteUrl, sqliteDatabasePath } from './db-url.js';
import { hashPassword } from './password-hash.js';

const bootstrapArgsSchema = z
  .object({
    email: z.email().max(320),
    password: z.string().min(12).max(1024),
    fullName: z.string().min(1).max(200).optional(),
    clinicName: z.string().min(1).max(200).optional(),
  })
  .strict();

export type BootstrapAdminArgs = z.infer<typeof bootstrapArgsSchema>;

export interface BootstrapAdminResult {
  readonly clinicId: string;
  readonly userId: string;
  readonly email: string;
}

export function parseBootstrapArgs(argv: readonly string[]): BootstrapAdminArgs {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (
      flag !== '--email' &&
      flag !== '--password' &&
      flag !== '--full-name' &&
      flag !== '--clinic-name'
    ) {
      throw new Error(`Unknown argument: ${flag ?? ''}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    args[flag.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
    index += 1;
  }

  const parsed = bootstrapArgsSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.path.join('.') || 'body').join(', ');
    throw new Error(`Invalid bootstrap arguments: ${issues}`);
  }
  return parsed.data;
}

export async function bootstrapAdmin(args: BootstrapAdminArgs): Promise<BootstrapAdminResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const clinicId = z.uuid().parse(process.env.CLINIC_ID);
  const clinicName = args.clinicName ?? process.env.CLINIC_NAME ?? 'Denti-Code U3';
  const timeZone = process.env.CLINIC_TIMEZONE ?? 'America/Lima';
  const currencyCode = process.env.CLINIC_CURRENCY ?? 'BOB';
  const userId = randomUUID();
  const email = args.email;
  const fullName = args.fullName ?? email.split('@')[0]!;
  const passwordHash = await hashPassword(args.password);

  const clinicValues = {
    id: clinicId,
    name: clinicName,
    timeZone,
    currencyCode,
    isActive: true,
  };
  const userValues = {
    id: userId,
    clinicId,
    email,
    passwordHash,
    fullName,
    role: 'ADMINISTRATOR' as const,
    isActive: true,
  };

  if (isSqliteUrl(databaseUrl)) {
    ensureSqliteDatabaseDirectory(databaseUrl);
    const client = new Database(sqliteDatabasePath(databaseUrl));
    client.pragma('foreign_keys = ON');
    const sqliteDb = drizzle(client, { schema: sqliteSchema, casing: 'snake_case' });
    try {
      const [existing] = await sqliteDb
        .select({ id: sqliteSchema.users.id })
        .from(sqliteSchema.users)
        .where(eq(sqliteSchema.users.clinicId, clinicId))
        .limit(1);
      if (existing) {
        throw new Error('The clinic already has users; first-admin bootstrap refuses to continue');
      }
      await sqliteDb.insert(sqliteSchema.clinics).values(clinicValues).onConflictDoNothing();
      await sqliteDb.insert(sqliteSchema.users).values(userValues);
    } finally {
      client.close();
    }
  } else {
    const sql = postgres(databaseUrl, { max: 1 });
    const db = postgresDrizzle(sql, { schema: pgSchema, casing: 'snake_case' });
    try {
      const [existing] = await db
        .select({ id: pgSchema.users.id })
        .from(pgSchema.users)
        .where(eq(pgSchema.users.clinicId, clinicId))
        .limit(1);
      if (existing) {
        throw new Error('The clinic already has users; first-admin bootstrap refuses to continue');
      }
      await db.insert(pgSchema.clinics).values(clinicValues).onConflictDoNothing();
      await db.insert(pgSchema.users).values(userValues);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  return { clinicId, userId, email };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  try {
    const args = parseBootstrapArgs(process.argv.slice(2));
    const result = await bootstrapAdmin(args);
    console.log(`First administrator created: ${result.email}`);
    console.log(`CLINIC_ID=${result.clinicId}`);
  } catch (error) {
    console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
