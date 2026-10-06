/**
 * `startWalkInVisit` — the walk-in door, tested without a database.
 *
 * What is worth testing here is the part no pure function in `visit-lifecycle.ts`
 * does, because there is deliberately no `startWalkInVisit` beside
 * `startVisitFromAppointment`: the bridge carries three rules (a completed
 * appointment, a departed dentist, an appointment that already became a visit) and
 * this door carries none of its own. Its one rule — who may be *named* — is
 * `assertResourcesAreBookable`, already tested where it lives, so what this file
 * pins is the arrangement around it:
 *
 *  - the row a walk-in is, which is the whole answer to "what does a `visits` row
 *    look like with no appointment behind it" (ADR 0021);
 *  - the order: the rule runs before an id is allocated and before anything is
 *    written, so a refused walk-in costs neither;
 *  - the silence the domain is supposed to keep — a name it cannot find is left to
 *    the tenant foreign keys, exactly as it is for a booking.
 *
 * The refusals that need a real table — another clinic's patient, another clinic's
 * clinician — are `visits-route.integration.test.ts`'s job, because there the
 * foreign keys are the ones answering.
 */

import { describe, expect, it } from 'vitest';

import {
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  asVisitId,
  type IsoDateTime,
  type VisitId,
} from '@denti-code-u3/types';
import type { ChairRepository, DentistRepository, VisitRepository } from '../ports/index.js';
import { DomainError } from '../shared/errors.js';
import type { Visit } from './visit-lifecycle.js';
import { startWalkInVisit, type WalkInVisitRequest } from './walk-in-visit.js';

const CLINIC = asClinicId('55555555-5555-4555-8555-555555555555');
const PATIENT = asPatientId('11111111-1111-4111-8111-111111111111');
const DENTIST = asDentistId('22222222-2222-4222-8222-222222222222');
const CHAIR = asChairId('77777777-7777-4777-8777-777777777777');
const VISIT_ID = asVisitId('33333333-3333-4333-8333-333333333333');
const NOW = '2026-10-06T14:30:00.000Z' as IsoDateTime;

interface Options {
  readonly dentistActive?: boolean;
  readonly chairActive?: boolean;
  /** What `findById` answers for a resource: `undefined` means "not found here". */
  readonly findsDentist?: boolean;
}

function harness(options: Options = {}) {
  const written: Visit[] = [];
  let allocated = 0;

  const dentists: DentistRepository = {
    findById: async () =>
      options.findsDentist === false
        ? undefined
        : {
            id: DENTIST,
            userId: null,
            fullName: 'Dr Local',
            speciality: null,
            color: null,
            isActive: options.dentistActive ?? true,
          },
  } as unknown as DentistRepository;

  const chairs: ChairRepository = {
    findById: async () => ({
      id: CHAIR,
      roomId: null,
      roomName: null,
      name: 'Chair 1',
      isActive: options.chairActive ?? true,
    }),
  } as unknown as ChairRepository;

  const visits = {
    save: async (visit: Visit) => {
      written.push(visit);
    },
  } as unknown as VisitRepository;

  return {
    written,
    allocated: () => allocated,
    dependencies: {
      visits,
      dentists,
      chairs,
      clock: { now: () => NOW },
      newId: (): VisitId => {
        allocated += 1;
        return VISIT_ID;
      },
    },
  };
}

const request: WalkInVisitRequest = {
  patientId: PATIENT,
  dentistId: DENTIST,
  chairId: CHAIR,
};

describe('startWalkInVisit', () => {
  it('writes an OPEN visit with no appointment behind it', async () => {
    const { written, dependencies } = harness();

    const visit = await startWalkInVisit(CLINIC, request, dependencies);

    expect(visit).toEqual({
      id: VISIT_ID,
      clinicId: CLINIC,
      patientId: PATIENT,
      dentistId: DENTIST,
      chairId: CHAIR,
      startedAt: NOW,
      status: 'OPEN',
    });
    // Absent, not null: a walk-in has no booking, and the key is the whole of what
    // distinguishes this row from one the bridge wrote. Asserted with `toEqual`
    // above — this line says why the missing key is the point rather than an
    // omission the matcher happened to accept.
    expect('appointmentId' in visit).toBe(false);
    expect(written).toHaveLength(1);
  });

  it('leaves the chair out entirely when none was named', async () => {
    const { written, dependencies } = harness();

    await startWalkInVisit(CLINIC, { patientId: PATIENT, dentistId: DENTIST }, dependencies);

    // No `chairId` key, rather than a null: "not chosen yet" and "a chair that was
    // removed from the clinic" are different facts and the column's `set null`
    // already speaks for the second one.
    expect('chairId' in (written[0] as Visit)).toBe(false);
  });

  it('refuses an inactive clinician and writes nothing', async () => {
    const { written, allocated, dependencies } = harness({ dentistActive: false });

    await expect(startWalkInVisit(CLINIC, request, dependencies)).rejects.toMatchObject({
      code: 'UNBOOKABLE_RESOURCE',
      message: expect.stringContaining('Dr Local'),
    });

    // Nothing written, and no id burned — the rule runs first so that a walk-in the
    // clinic would not accept does not consume a number a real visit needs.
    expect(written).toEqual([]);
    expect(allocated()).toBe(0);
  });

  it('refuses an inactive chair and writes nothing', async () => {
    const { written, dependencies } = harness({ chairActive: false });

    await expect(startWalkInVisit(CLINIC, request, dependencies)).rejects.toMatchObject({
      code: 'UNBOOKABLE_RESOURCE',
      message: expect.stringContaining('Chair 1'),
    });

    expect(written).toEqual([]);
  });

  it('stays silent about a clinician it cannot find, leaving the answer to the keys', async () => {
    const { written, dependencies } = harness({ findsDentist: false });

    // `findById` cannot tell an absent id from another clinic's and must not
    // (ADR 0014), so the rule says nothing and the composite tenant foreign key
    // answers `INVALID_INPUT` when the row is written. Two answers for one bad
    // reference would mean one of them is wrong (ADR 0020).
    await expect(startWalkInVisit(CLINIC, request, dependencies)).resolves.toMatchObject({
      status: 'OPEN',
    });
    expect(written).toHaveLength(1);
  });

  it('reports a refusal as a DomainError, so a route can turn it into a status', async () => {
    const { dependencies } = harness({ dentistActive: false });

    await expect(startWalkInVisit(CLINIC, request, dependencies)).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('uses the clock, because a walk-in has no booked time to fall back on', async () => {
    const { dependencies } = harness();

    const visit = await startWalkInVisit(CLINIC, request, dependencies);

    expect(visit.startedAt).toBe(NOW);
  });
});
