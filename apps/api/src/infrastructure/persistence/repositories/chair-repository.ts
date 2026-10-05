/**
 * Chair persistence, on PostgreSQL.
 *
 * A chair is a treatment unit (sillón), and this is the read a booking needs: which
 * chairs the clinic has, and which room each is in.
 *
 * **`roomName` is joined here rather than left to the caller.** The chair's own name
 * is "Sillón 1", which means nothing on its own in a clinic with three rooms and
 * four chairs; a uuid in a dropdown is worse than no dropdown. Joining one more
 * table to name a room is cheaper than every client re-deriving it, and it keeps the
 * answer in one place — the same argument as the agenda read model naming the patient
 * and the dentist.
 *
 * The join is a `LEFT JOIN` because `chairs.room_id` is nullable: a chair that has
 * never been assigned to a room is still a chair the clinic books into, and an inner
 * join would quietly hide it from a list of bookable resources.
 */

import type { ChairListRequest, ChairRepository, ChairSummary } from '@denti-code-u3/domain';
import { asChairId, type ChairId, type ClinicId } from '@denti-code-u3/types';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { chairs, rooms } from '@denti-code-u3/database/schema';

import type { DentiDatabase } from '../postgres/connection.js';
import { foldable } from '../postgres/fold-accents.js';

export class DrizzleChairRepository implements ChairRepository {
  constructor(private readonly db: DentiDatabase) {}

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
      // The same join as the list, including the `LEFT`: the booking rule only asks
      // whether the chair can be booked, but a summary is this shape and returning a
      // narrower one here would be a second shape for the same concept.
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
