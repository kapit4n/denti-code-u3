/**
 * User persistence, on PostgreSQL.
 *
 * The first implementation of the ports authentication needs. Two decisions are
 * worth stating because they are security decisions, not storage ones:
 *
 *  - **Login looks up by clinic and email, case-insensitively.** A person does not
 *    think their address has a case, and the unique index is on the exact string.
 *    Lowercasing both sides makes `Ana@` and `ana@` the same account at login
 *    without changing how the row is stored.
 *  - **The credential hash is returned only from `findByEmailForLogin`.** Every
 *    other read returns `AuthenticatedUser`, which has no hash field at all, so a
 *    route that hands a user back to a client cannot leak the hash by accident.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { users } from '@denti-code-u3/database/schema';
import type { AuthenticatedUser, UserRepository, UserWithCredentials } from '@denti-code-u3/domain';
import {
  asClinicId,
  asUserId,
  type ClinicId,
  type IsoDateTime,
  type UserId,
} from '@denti-code-u3/types';

import type { DentiDatabase } from '../postgres/connection.js';
import type { ClinicRole } from '@denti-code-u3/domain';

type UserRow = typeof users.$inferSelect;

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      // Nullable column: absent means the user has no password yet, which is a
      // refusal at login rather than an empty string to compare against.
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
