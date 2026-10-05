/**
 * Who may be named by a booking.
 *
 * **The rule, decided as product question 17:** a clinician who is marked
 * inactive cannot be booked, and neither can a chair that is. This used to be
 * enforced by nothing at all — `createAppointment` never read `isActive`, so the
 * only thing stopping a booking with a dentist who has left was a client that
 * happened to hide the row. A rule that lives in the browser is a rule the second
 * client, the import script and the curl in the terminal do not have, and this
 * project keeps business rules in the domain.
 *
 * **Where it is applied, and the awkward case that falls out of it.** The rule is
 * checked by the two use cases that *name* a resource — create and reschedule — and
 * not by the status transition, which names nobody. Reschedule checks the value the
 * booking will have after the move, which includes the one it already had. So if a
 * clinician is deactivated while holding future appointments, moving one of those
 * appointments is refused until it is reassigned.
 *
 * That is deliberate rather than convenient. The alternative — "you may keep a name
 * you already used, but you may not introduce a new one" — makes an inactive
 * clinician permanently bookable by anyone who books once and then only drags, is
 * the kind of rule that cannot be explained to a receptionist in one sentence, and
 * needs the existing appointment to hand in order to be evaluated at all. The
 * message names the clinician and says what to do about it, so the refusal is a
 * prompt to reassign rather than a dead end.
 *
 * **A reference that does not exist is left to the database.** `findById` answers
 * `undefined` both for an id that is absent and for one belonging to another clinic,
 * and it must: telling a caller that an id exists in a clinic it is not scoped to is
 * itself a disclosure (ADR 0014). So this rule stays silent for a name it cannot
 * find, and the tenant foreign keys answer instead — as `INVALID_INPUT`, "That
 * patient, dentist, chair or room is not in this clinic". Two rules for one bad
 * reference would mean two answers, and the second would be the wrong one.
 */

import { DomainError } from '../shared/errors.js';
import type { ChairRepository, DentistRepository } from '../ports/index.js';
import type { ChairId, ClinicId, DentistId } from '@denti-code-u3/types';

/** The two repositories this rule reads. Named here so the rule has no other door. */
export interface BookableResourceReader {
  readonly dentists: DentistRepository;
  readonly chairs: ChairRepository;
}

/** The names a booking will carry, once the caller has been given "leave it as it is". */
export interface BookableResourceNames {
  readonly dentistId?: DentistId;
  readonly chairId?: ChairId;
}

/**
 * Refuses a booking that names an inactive clinician or chair.
 *
 * Both lookups happen only when something was named: an appointment with no chair
 * is a booking in a chair that has not been chosen yet, which is a different state
 * than a booking in a chair that is out of service.
 */
export async function assertResourcesAreBookable(
  clinicId: ClinicId,
  names: BookableResourceNames,
  resources: BookableResourceReader,
): Promise<void> {
  if (names.dentistId) {
    const dentist = await resources.dentists.findById(clinicId, names.dentistId);

    if (dentist && !dentist.isActive) {
      throw new DomainError(
        'UNBOOKABLE_RESOURCE',
        `${dentist.fullName} is marked inactive and cannot be booked. Put the clinician back in service, or book someone else.`,
        { dentistId: dentist.id },
      );
    }
  }

  if (names.chairId) {
    const chair = await resources.chairs.findById(clinicId, names.chairId);

    if (chair && !chair.isActive) {
      throw new DomainError(
        'UNBOOKABLE_RESOURCE',
        `${chair.name} is marked inactive and cannot be booked. Put the chair back in service, or book another one.`,
        { chairId: chair.id },
      );
    }
  }
}
