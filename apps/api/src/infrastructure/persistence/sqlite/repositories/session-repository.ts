/**
 * Session persistence, on SQLite — the twin of
 * `repositories/session-repository.ts` (ADR 0025).
 *
 * Same shape and the same decision: `findByTokenHash` returns the row whatever
 * its state, and the domain decides whether it is usable. Timestamps are `Date`
 * over the integer `timestamp_ms` columns, converted at this boundary.
 */

import { eq } from 'drizzle-orm';

import { sessions } from '@denti-code-u3/database/schema/sqlite';
import type { Session, SessionRepository } from '@denti-code-u3/domain';
import { asClinicId, asUserId, type IsoDateTime } from '@denti-code-u3/types';

import type { SqliteDatabase } from '../connection.js';

type SessionRow = typeof sessions.$inferSelect;

export class SQLiteSessionRepository implements SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(session: Session): Promise<void> {
    await this.db.insert(sessions).values({
      id: session.id,
      tokenHash: session.tokenHash,
      userId: session.userId,
      clinicId: session.clinicId,
      issuedAt: new Date(session.issuedAt),
      expiresAt: new Date(session.expiresAt),
      revokedAt: session.revokedAt === undefined ? null : new Date(session.revokedAt),
    });
  }

  async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    return row ? toSession(row) : undefined;
  }

  async revoke(tokenHash: string, at: IsoDateTime): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date(at) })
      .where(eq(sessions.tokenHash, tokenHash));
  }
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    userId: asUserId(row.userId),
    clinicId: asClinicId(row.clinicId),
    issuedAt: row.issuedAt.toISOString() as IsoDateTime,
    expiresAt: row.expiresAt.toISOString() as IsoDateTime,
    ...(row.revokedAt === null ? {} : { revokedAt: row.revokedAt.toISOString() as IsoDateTime }),
  };
}
