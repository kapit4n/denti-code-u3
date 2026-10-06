/**
 * The walk-in: a patient who arrives with no booking.
 *
 * This is the second door a visit comes in through, and ADR 0021 held it back for
 * exactly this reason — it is a *different request*, not an optional field on the
 * first one. `startVisit` reads a booking and takes the patient, the clinician and
 * the chair from it, so there is no body that can disagree with the appointment it
 * came from. A walk-in has no appointment to read, so those three are the caller's
 * to say, and saying them is the whole of what this use case is asked.
 *
 * ## Why the clinician is required
 *
 * The same reason `startVisitFromAppointment` refuses an appointment whose dentist
 * has left: a visit exists to record treatment, treatment is attributable to a
 * clinician, and attributing it to nobody is not a record (ADR 0021 §5). The column
 * is nullable because a clinician may *leave* afterwards — that is a fact about the
 * future of an existing row, not an invitation to create one without a name. Making
 * the walk-in the door that skips the rule would mean two answers for the question
 * "who treated this patient", decided by which button the receptionist pressed.
 *
 * The chair is optional, for the same reason it is optional on a booking: a walk-in
 * is seated when a chair is free, and a visit with no chair is a visit in a chair
 * that has not been chosen yet — a different state from one in a chair that is out
 * of service, which is what the rule below refuses.
 *
 * ## What this use case deliberately does not do
 *
 * - **It does not create an appointment.** There is no booking to create: the
 *   patient did not ask for a time and the clinic did not hold one. The visible
 *   cost is stated rather than hidden — a walk-in does not appear on the agenda and
 *   is not counted by the dashboard's `inTreatment` total, because both read the
 *   book and a walk-in is not in it. The clinical record is where a walk-in lives:
 *   the patient's timeline and profile both show it.
 * - **It does not check opening hours.** `createAppointment` refuses a booking
 *   outside the clinic's day because a booking is a promise about the future. A
 *   walk-in records care that is happening now, and refusing an emergency at 21:00
 *   would stop the clinic writing down what it actually did. Same reasoning as
 *   `startVisit`, which does not ask whether the booking's day is still open.
 * - **It does not read the patient.** Whether the id names a real patient of this
 *   clinic is the composite tenant foreign key's answer, exactly as it is for the
 *   patient of a booking (ADR 0014): `INVALID_INPUT` at 422, "That patient, dentist,
 *   chair or room is not in this clinic". The repository translates that refusal;
 *   without the translation it would arrive as a 500.
 * - **It does not refuse a second open visit for the same patient.** That rule may
 *   well be right — a patient cannot be in two chairs at once — but it applies to
 *   *both* doors, and the appointment bridge shipped without it. Adding it here
 *   would make the two doors disagree, and adding it to both without being asked is
 *   inventing a product rule. It is product question 19.
 *
 * ## No `UnitOfWork`
 *
 * One row, so there is nothing to make atomic. `startVisit` takes a transaction
 * because it writes a visit *and* moves an appointment, and a seam that can be
 * handed two repositories is one refactor away from writing them separately (ADR
 * 0021); neither statement exists here. This is the same argument ADR 0022 made
 * for the two closing use cases, arriving at the same place from the other side.
 */
import type { ChairId, ClinicId, DentistId, PatientId, VisitId } from '@denti-code-u3/types';

import type { Clock } from '../shared/clock.js';
import type { ChairRepository, DentistRepository, VisitRepository } from '../ports/index.js';
import { assertResourcesAreBookable } from '../appointment/bookable-resources.js';
import type { Visit } from './visit-lifecycle.js';

/** What a caller asks for: who came in, who will treat them, and where they sit. */
export interface WalkInVisitRequest {
  readonly patientId: PatientId;
  readonly dentistId: DentistId;
  readonly chairId?: ChairId;
}

/**
 * What starting a walk-in needs from the outside world.
 *
 * The two resource repositories are required and not optional, for the reason ADR
 * 0020 split the appointment dependencies: a walk-in that could be wired without
 * them would be a creation path where the "who may be named" rule silently does not
 * run. Everything else is the same trio the other visit use cases take.
 */
export interface WalkInVisitDependencies {
  readonly visits: VisitRepository;
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;
  readonly clock: Clock;
  /** The id the new visit is written under, allocated once the rules have agreed. */
  readonly newId: () => VisitId;
}

/**
 * Start a visit for a patient who arrived without a booking.
 *
 * Answers with the visit as the database now holds it — the same promise every
 * visit write makes, and here it is the whole answer: there is no appointment to
 * report alongside it.
 *
 * The order matters twice. The bookable-resource rule runs *before* the id is
 * allocated, so a walk-in refused for a departed clinician consumes no number a
 * real visit will need; and the rules run before the write, because a single
 * statement has no second chance to take itself back.
 */
export async function startWalkInVisit(
  clinicId: ClinicId,
  request: WalkInVisitRequest,
  dependencies: WalkInVisitDependencies,
): Promise<Visit> {
  await assertResourcesAreBookable(
    clinicId,
    {
      dentistId: request.dentistId,
      ...(request.chairId ? { chairId: request.chairId } : {}),
    },
    dependencies,
  );

  const visit: Visit = {
    id: dependencies.newId(),
    clinicId,
    patientId: request.patientId,
    dentistId: request.dentistId,
    ...(request.chairId ? { chairId: request.chairId } : {}),
    // The clock, not the request: a client cannot file a walk-in that started last
    // Tuesday, and there is no booked time to fall back on — this *is* the time.
    startedAt: dependencies.clock.now(),
    // No `appointmentId` key at all, rather than a null: "this visit has no booking
    // behind it" is spelled as an absent key everywhere else in the entity, and the
    // repository writes the column only when the key is present.
    status: 'OPEN',
  };

  await dependencies.visits.save(visit);

  return visit;
}
