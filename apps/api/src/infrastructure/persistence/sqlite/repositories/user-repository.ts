/**
 * User persistence, on SQLite — the twin of `repositories/user-repository.ts`
 * (ADR 0025).
 *
 * Same decisions, same query shapes: login folds the email case on both sides,
 * and the credential hash travels only on the login read. `lower(...)` is native
 * SQLite, so the fold is the same one the index-free comparison PostgreSQL uses.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { users } from '@denti-code-u3/database/schema/sqlite';
import type { AuthenticatedUser, UserRepository, UserWithCredentials } from '@denti-code-u3/domain';
import {
  asClinicId,
  asUserId,
  type ClinicId,
  type IsoDateTime,
  type UserId,
} from '@denti-code-u3/types';

import type { SqliteDatabase } from '../connection.js';
import type { ClinicRole } from '@denti-code-u3/domain';

type UserRow = typeof users.$inferSelect;

export class SQLiteUserRepository implements UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findByEmailForLogin(
    clinicId: ClinicId,
    email: string,
  ): Promise<UserWithCredentials | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), sql`lower(${users.email}) = lower(${email})`))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return {
      user: toUser(row),
      ...(row.passwordHash === null ? {} : { passwordHash: row.passwordHash }),
    };
  }

  async findById(clinicId: ClinicId, userId: UserId): Promise<AuthenticatedUser | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, userId)))
      .limit(1);

    return row ? toUser(row) : undefined;
  }

  async listByClinic(clinicId: ClinicId): Promise<readonly AuthenticatedUser[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.clinicId, clinicId))
      .orderBy(asc(users.fullName));

    return rows.map(toUser);
  }

  async recordLogin(clinicId: ClinicId, userId: UserId, at: IsoDateTime): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date(at) })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, userId)));
  }

  async save(user: AuthenticatedUser & { readonly passwordHash: string }): Promise<void> {
    await this.db.insert(users).values({
      id: user.id,
      clinicId: user.clinicId,
      email: user.email,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
    });
  }
}

function toUser(row: UserRow): AuthenticatedUser {
  return {
    id: asUserId(row.id),
    clinicId: asClinicId(row.clinicId),
    email: row.email,
    fullName: row.fullName,
    role: row.role as ClinicRole,
    isActive: row.isActive,
    ...(row.lastLoginAt === null
      ? {}
      : { lastLoginAt: row.lastLoginAt.toISOString() as IsoDateTime }),
  };
}
