/**
 * Chair persistence, on SQLite — the twin of
 * `repositories/chair-repository.ts` (ADR 0025).
 *
 * The `LEFT JOIN` that names the room survives intact: the SQLite schema has
 * the same nullable `chairs.room_id`, and a chair that has never been assigned
 * to a room is still a chair the clinic books into.
 */

import type { ChairListRequest, ChairRepository, ChairSummary } from '@denti-code-u3/domain';
import { asChairId, type ChairId, type ClinicId } from '@denti-code-u3/types';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { chairs, rooms } from '@denti-code-u3/database/schema/sqlite';

import type { SqliteDatabase } from '../connection.js';
import { sqliteFoldable as foldable } from '../../fold-accents.js';

export class SQLiteChairRepository implements ChairRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listByClinic(
    clinicId: ClinicId,
    request: ChairListRequest = {},
  ): Promise<readonly ChairSummary[]> {
    const rows = await this.db
      .select({
        id: chairs.id,
        roomId: chairs.roomId,
        roomName: rooms.name,
        name: chairs.name,
        isActive: chairs.isActive,
      })
      .from(chairs)
      .leftJoin(rooms, eq(rooms.id, chairs.roomId))
      .where(this.scope(clinicId, request))
      .orderBy(asc(foldable(chairs.name)), asc(chairs.id));

    return rows.map((row) => ({
      id: asChairId(row.id),
      roomId: row.roomId,
      roomName: row.roomName,
      name: row.name,
      isActive: row.isActive,
    }));
  }

  async findById(clinicId: ClinicId, chairId: ChairId): Promise<ChairSummary | undefined> {
    const [row] = await this.db
      .select({
        id: chairs.id,
        roomId: chairs.roomId,
        roomName: rooms.name,
        name: chairs.name,
        isActive: chairs.isActive,
      })
      .from(chairs)
      .leftJoin(rooms, eq(rooms.id, chairs.roomId))
      .where(and(eq(chairs.clinicId, clinicId), eq(chairs.id, chairId)))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return {
      id: asChairId(row.id),
      roomId: row.roomId,
      roomName: row.roomName,
      name: row.name,
      isActive: row.isActive,
    };
  }

  private scope(clinicId: ClinicId, request: ChairListRequest): SQL | undefined {
    return and(
      eq(chairs.clinicId, clinicId),
      request.onlyActive ? eq(chairs.isActive, true) : undefined,
    );
  }
}
