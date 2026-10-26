/**
 * Session persistence, on PostgreSQL.
 *
 * The only non-obvious choice is that `findByTokenHash` does **not** filter out
 * expired or revoked rows. Expiry and revocation are domain decisions
 * (`assertSessionUsable`), and a query that hid them would collapse three
 * different refusals into one "not found", which is exactly the information the
 * use case needs to stay honest about.
 */

import { eq } from 'drizzle-orm';

import { sessions } from '@denti-code-u3/database/schema';
import type { Session, SessionRepository } from '@denti-code-u3/domain';
import { asClinicId, asUserId, type IsoDateTime } from '@denti-code-u3/types';

import type { DentiDatabase } from '../postgres/connection.js';

type SessionRow = typeof sessions.$inferSelect;

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: DentiDatabase) {}

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
    // Overwriting an existing `revoked_at` would move the recorded end of the
    // session forward on a repeated logout. Only the first revocation counts.
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
