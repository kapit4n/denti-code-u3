/**
 * The booking dialog: a slot, and who is coming to it.
 *
 * Two doors, one dialog. Opened from the **grid**, it arrives with a slot: the click
 * was the choice of when, and the field below starts there so nobody retypes what the
 * grid already answered. It starts there rather than stopping there — the field stays
 * editable, because a receptionist who meant 10:30 and clicked 10:00 should fix it in
 * place instead of closing the dialog and hunting for another empty lane, and in the
 * month view a click can only ever name a *day*, leaving the hour to be stated here.
 * Opened from a **patient's profile** or the **dashboard** there is no slot behind it
 * and nothing else on the screen can answer "when", so the same field starts empty and
 * the person types the time. Either way the value is a clinic wall clock.
 *
 * **The time is always the clinic's clock, whatever the machine says.** The field holds
 * a wall clock (`2026-10-06T09:00`) and the dialog turns it into the instant the API
 * stores using the zone on the clinic record, via `zonedWallClock.ts`. That is the same
 * reason the grid renders in `clinic.timeZone`: a receptionist in another country
 * booking 09:00 means 09:00 *here*.
 *
 * **A time the zone skipped is refused here rather than shifted.** Twice a year the
 * clocks jump an hour forward and some wall clocks never arrive; the conversion says so
 * and the dialog puts the sentence under the field, because the alternative is booking
 * a patient for an hour they did not choose and mentioning it nowhere.
 *
 * **It decides nothing about whether the booking is allowed.** The slot is not checked
 * for opening hours, the clinician is not checked for a clash, and the duration is
 * not checked against a policy: `POST /appointments` answers those, and the dialog
 * shows whatever sentence came back. A dialog that pre-judged them would answer
 * differently from the server the first time the two drifted, which is the same
 * argument that keeps the overlap rules out of `agenda-calendar.tsx`.
 *
 * **Inactive clinicians and chairs are not offered, and that is a convenience rather
 * than the rule.** The two lists are fetched with `onlyActive`, so a clinician who
 * has left is not in the dropdown. The API still enforces it (ADR 0020), and a
 * clinician deactivated while the dialog is open produces a refusal naming them — the
 * client is not the authority, and pretending otherwise here would only hide the
 * server's sentence.
 *
 * **Every click on the grid opens it, including a slot at 03:00.** A slot outside
 * opening hours is refused by the domain with a message that says what the clinic's
 * hours are, which is more useful than a click that does nothing and explains
 * nothing.
 *
 * The form is React Hook Form with a Zod resolver over
 * `createAppointmentFormSchema`, whose fields are the very schema objects
 * `createAppointmentSchema` uses — so a field cannot be accepted here and refused by
 * the API. It holds no copy of the appointment it creates: it closes when the server
 * agrees, and the grid redraws from the refetch.
 */

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denti-code-u3/ui';
import { Loader2, AlertCircle } from 'lucide-react';
import {
  MAXIMUM_APPOINTMENT_MINUTES,
  MINIMUM_APPOINTMENT_MINUTES,
  type Clinic,
} from '@denti-code-u3/domain';
import {
  createAppointmentFormSchema,
  type CreateAppointmentFormOutput,
  type CreateAppointmentFormValues,
} from '@denti-code-u3/validation';

import { useCreateAppointment } from '../mutations/use-create-appointment.js';
import { useChairs, useDentists } from '../queries/bookable-resources-query.js';
import { describeAppointmentFailure } from '../describe-appointment-failure.js';
import { PatientPicker, type SelectedPatient } from '../../patients/components/patient-picker.js';
import { formatClinicDayTime, formatClinicTimeRange } from '../../clinic/format-clinic-time.js';
import { instantToZonedWallClock, zonedWallClockToInstant } from '../../clinic/zoned-wall-clock.js';
import { useTranslation } from '../../../i18n/index.js';

/**
 * The lengths a booking is offered at, in minutes.
 *
 * A short list rather than a free field, because "how long" is a clinic convention
 * rather than a number every receptionist chooses: asking for it as a dropdown keeps
 * the grid's blocks a consistent height, and it is the one field in this form where a
 * free number would produce more mistakes than it saves keystrokes.
 *
 * **Filtered by the domain's own bounds**, so the dropdown cannot offer a length the
 * API would refuse. The bounds come from `packages/domain` rather than being written
 * here, and this is the only place the list is defined: a second copy of the same
 * numbers is one of them going stale when the rule moves.
 */
const BOOKABLE_DURATIONS = [15, 30, 45, 60, 90, 120].filter(
  (minutes) => minutes >= MINIMUM_APPOINTMENT_MINUTES && minutes <= MAXIMUM_APPOINTMENT_MINUTES,
);

/** The first of the offered lengths, so the dialog opens on a plausible booking. */
const DEFAULT_DURATION_MINUTES = BOOKABLE_DURATIONS.includes(30) ? 30 : BOOKABLE_DURATIONS[0];

/**
 * Radix's `Select` reserves `''` for "no value shown", so an item cannot carry it —
 * which means "no chair" needs a value of its own for the dropdown to select it back.
 *
 * **The sentinel never reaches the form or the API.** It is mapped to and from the
 * form's own empty string at the dropdown boundary, because the schema that validates
 * this form is also the schema the API validates with, and it must not learn about a
 * word that exists only because of a component library.
 */
const NO_CHAIR = 'none';

export interface AppointmentBookingDialogProps {
  /**
   * The clicked slot, as an ISO instant, when the grid opened this dialog.
   *
   * Optional, and its absence is what leaves the field empty rather than pre-filled —
   * the whole of what the prop decides. It seeds the field and does not lock it, so
   * there is no `readOnly` flag and no caller can pass one that contradicts the other.
   */
  readonly startsAt?: string;
  readonly clinic: Clinic;
  /**
   * The patient this booking is for, when it was opened from someone's profile.
   *
   * Prefilled rather than locked: the dialog was reached by saying who it is for, but
   * a person who opened it by accident can pick someone else instead of closing it,
   * and locking the box turns that into two extra steps to undo a misclick.
   */
  readonly patient?: SelectedPatient;
  readonly onClose: () => void;
  /** Called after the API agrees, with the row the booking became. */
  readonly onBooked?: (entry: { readonly id: string }) => void;
}

export function AppointmentBookingDialog({
  startsAt,
  clinic,
  patient,
  onClose,
  onBooked,
}: AppointmentBookingDialogProps) {
  const { locale, t } = useTranslation();
  const create = useCreateAppointment();
  // Active rows only: a clinician or chair that cannot be booked should not be
  // offered here. The agenda's filters ask for the other list — see
  // `bookable-resources-query.ts` for why the two callers differ.
  const dentists = useDentists({ onlyActive: true });
  const chairs = useChairs({ onlyActive: true });

  /**
   * The clicked slot as the field's starting value.
   *
   * `undefined` means the grid did not open this dialog — or the instant was not an
   * instant, which lands in the same place: a field that starts empty is a form
   * somebody can finish, where one holding `Invalid DateTime` is not. Either way the
   * field is the person's; the slot is where the typing starts, not where it stops.
   */
  const slotWallClock =
    startsAt === undefined ? undefined : instantToZonedWallClock(startsAt, clinic.timeZone);

  /**
   * The chosen patient's name, held beside the id in the form.
   *
   * Not a field of the form because it is not sent to the API — a booking names a
   * patient by id, and a label travelling in the body would be a second thing the
   * server would have to ignore. Seeded from `patient` so opening from a profile shows
   * the name rather than an empty box that has to be searched to find the person the
   * dialog was just opened for.
   */
  const [patientLabel, setPatientLabel] = useState<string | undefined>(patient?.label);

  const form = useForm<CreateAppointmentFormValues, unknown, CreateAppointmentFormOutput>({
    resolver: zodResolver(createAppointmentFormSchema),
    defaultValues: {
      patientId: patient?.id ?? '',
      dentistId: '',
      // Pre-filled strings rather than `undefined`, for the reason the patient form
      // gives: a controlled input starting as `undefined` flickers on first render.
      chairId: '',
      localStartsAt: slotWallClock ?? '',
      durationMinutes: DEFAULT_DURATION_MINUTES,
      notes: '',
    },
  });

  const durationMinutes = form.watch('durationMinutes');
  const patientId = form.watch('patientId');
  const localStartsAt = form.watch('localStartsAt');

  /**
   * When this booking would be, in the clinic's own words.
   *
   * Recomputed as the time and the duration change, so the dialog shows the span that
   * is about to be booked rather than the slot that was clicked — which, after a
   * 90-minute choice, is not the same hour. `formatClinicTimeRange` takes instants, so
   * the end is computed the same way the domain computes it (ADR 0012) rather than by
   * adding minutes to a formatted string.
   *
   * Empty until there is a time to describe, which is the normal state of the dialog
   * when it was opened without a slot: the summary says what to do instead of
   * formatting nothing.
   */
  const span = formatChosenSpan(localStartsAt, durationMinutes, clinic.timeZone, locale);

  const onSubmit = form.handleSubmit((values) => {
    // The one field that cannot be settled by the schema alone. The form schema knows
    // the wall clock is shaped like a date and time; only the clinic's zone can say
    // whether that clock ever showed it, and a daylight-saving gap is the case where
    // they disagree. Refusing here is the honest answer — the other one is 03:30.
    const startsAtInstant = zonedWallClockToInstant(values.localStartsAt, clinic.timeZone);

    if (startsAtInstant === undefined) {
      form.setError('localStartsAt', {
        type: 'value',
        message: t('agenda.booking.invalidTime', { timeZone: clinic.timeZone }),
      });
      return;
    }

    // Spelled out field by field rather than spread, because this object is the
    // request: it is the last place a field can be named on purpose instead of by
    // accident, and `localStartsAt` — a form field — must not ride along in it.
    create.mutate(
      {
        patientId: values.patientId,
        dentistId: values.dentistId,
        chairId: values.chairId,
        startsAt: startsAtInstant,
        durationMinutes: values.durationMinutes,
        notes: values.notes,
      },
      {
        onSuccess: (entry) => {
          onBooked?.(entry);
          onClose();
        },
      },
    );
  });

  const failure = describeAppointmentFailure(create.error, {
    timeZone: clinic.timeZone,
    fallback: t('agenda.booking.error'),
    locale,
    messages: {
      conflict: t('agenda.failure.conflict'),
      conflictOne: t('agenda.failure.conflictOne'),
      conflictMany: t('agenda.failure.conflictMany'),
      notFound: t('agenda.failure.notFound'),
      network: t('agenda.failure.network'),
    },
  });

  const loadingResources = dentists.isPending || chairs.isPending;

  return (
    <Dialog
      open
      // Escape and the overlay mean the same thing: stop looking at this slot. Nothing
      // is written, and nothing is lost — the slot is still free and still clickable.
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-labelledby="booking-dialog-title"
        data-testid="appointment-booking-dialog"
      >
        <DialogHeader>
          <DialogTitle id="booking-dialog-title">
            {patient
              ? t('agenda.booking.newForPatient', { patient: patient.label })
              : t('agenda.booking.new')}
          </DialogTitle>
          <DialogDescription>
            {/* The span, once there is a time to describe it from. Before that it says
                what to do — the alternative is a header reading "New appointment ·
                Invalid DateTime" for the normal state of a dialog opened without a
                slot. The zone itself is not repeated here; it says so once, under the
                field that needs it. */}
            {span ?? t('agenda.booking.chooseTime')}
          </DialogDescription>
        </DialogHeader>

        {failure ? (
          <div
            role="alert"
            data-testid="booking-error"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="booking-starts-at">{t('agenda.booking.dateTime')}</Label>
            <input
              id="booking-starts-at"
              type="datetime-local"
              // Editable whether or not a slot seeded it. The click is a starting
              // point, not a verdict: the month view names only a day, a mistyped lane
              // is corrected here rather than by starting over, and a field that
              // refuses the very hour it is asking for is a form that cannot be
              // finished on its own terms.
              disabled={create.isPending}
              aria-describedby="booking-starts-at-hint"
              className="w-full rounded-md border bg-background p-2 text-sm"
              data-testid="booking-starts-at"
              {...form.register('localStartsAt')}
            />
            {/* Says whose clock, because a wall clock with no zone is ambiguous and
                the person filling this in may be a thousand miles from the clinic —
                and the zone matters most when the hour is theirs to change. */}
            <p id="booking-starts-at-hint" className="text-xs text-muted-foreground">
              {slotWallClock !== undefined
                ? t('agenda.booking.hintFromSlot', { timeZone: clinic.timeZone })
                : t('agenda.booking.hintTyped', { timeZone: clinic.timeZone })}
            </p>
            <FieldError error={form.formState.errors.localStartsAt} />
          </div>

          <PatientPicker
            id="booking-patient"
            disabled={create.isPending}
            describedBy={form.formState.errors.patientId ? 'booking-patient-error' : undefined}
            value={patientId ? { id: patientId, label: patientLabel ?? '' } : undefined}
            onChange={(patient: SelectedPatient | undefined) => {
              setPatientLabel(patient?.label);
              form.setValue('patientId', patient?.id ?? '');
            }}
          />
          <FieldError id="booking-patient-error" error={form.formState.errors.patientId} />

          <div className="space-y-1">
            <Label htmlFor="booking-dentist">
              {t('agenda.booking.clinician')}
              <span aria-hidden> *</span>
            </Label>
            <Select
              // Radix's root is uncontrolled with a value, or controlled with
              // `value`/`onValueChange`. The form owns the value, so this is the
              // controlled shape and `form.setValue` is the only writer.
              value={form.watch('dentistId')}
              onValueChange={(value) => form.setValue('dentistId', value)}
              disabled={create.isPending}
            >
              <SelectTrigger id="booking-dentist" data-testid="booking-dentist">
                <SelectValue placeholder={t('agenda.booking.chooseClinician')} />
              </SelectTrigger>
              <SelectContent>
                {(dentists.data?.items ?? []).map((dentist) => (
                  <SelectItem key={dentist.id} value={dentist.id}>
                    {dentist.speciality
                      ? `${dentist.fullName} — ${dentist.speciality}`
                      : dentist.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError error={form.formState.errors.dentistId} />
            {dentists.isPending ? (
              <p className="text-xs text-muted-foreground" role="status">
                {t('agenda.booking.loadingClinicians')}
              </p>
            ) : null}
            {!dentists.isPending && (dentists.data?.items.length ?? 0) === 0 ? (
              // Said out loud rather than showing an empty dropdown: a clinic with no
              // active clinician cannot book anything, and a silent select looks like a
              // form that has not loaded.
              <p className="text-xs text-muted-foreground">{t('agenda.booking.noClinician')}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-duration">{t('agenda.booking.duration')}</Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(value) =>
                  form.setValue('durationMinutes', Number(value), { shouldValidate: true })
                }
                disabled={create.isPending}
              >
                <SelectTrigger id="booking-duration" data-testid="booking-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOOKABLE_DURATIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {t('agenda.booking.minutes', { minutes })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="booking-chair">{t('agenda.booking.chair')}</Label>
              <Select
                // An empty form value means "no chair", which the dropdown shows as
                // its own first item. Going from a chair back to none works because
                // the sentinel is a real item rather than the empty string Radix
                // reserves for "nothing chosen".
                value={form.watch('chairId') || NO_CHAIR}
                onValueChange={(value) => form.setValue('chairId', value === NO_CHAIR ? '' : value)}
                disabled={create.isPending}
              >
                <SelectTrigger id="booking-chair" data-testid="booking-chair">
                  <SelectValue placeholder={t('agenda.booking.noChairOption')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHAIR}>{t('agenda.booking.noChairOption')}</SelectItem>
                  {(chairs.data?.items ?? []).map((chair) => (
                    <SelectItem key={chair.id} value={chair.id}>
                      {chair.roomName ? `${chair.name} (${chair.roomName})` : chair.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError error={form.formState.errors.chairId} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="booking-notes">{t('agenda.booking.notes')}</Label>
            <textarea
              id="booking-notes"
              rows={2}
              disabled={create.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder={t('agenda.booking.notesPlaceholder')}
              {...form.register('notes')}
            />
            <FieldError error={form.formState.errors.notes} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending} data-testid="booking-submit">
              {create.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('agenda.booking.booking')}
                </>
              ) : (
                t('agenda.booking.book')
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </form>

        {loadingResources ? (
          <p className="text-xs text-muted-foreground" role="status">
            {t('agenda.booking.loadingResources')}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A field's validation message, or nothing.
 *
 * **Every field that can be refused gets one of these**, including the optional ones.
 * That is not tidiness: a field whose failure had nowhere to appear produced a submit
 * button that did nothing and no sentence explaining why, which is the worst state a
 * form can be in. The chair and the notes are the two that nearly got away — the chair
 * can only hold an id the API just sent us, so a bad one means our own server is
 * unwell, and the form still has to say so rather than swallow it.
 */
function FieldError({
  id,
  error,
}: {
  /**
   * Only the patient field needs one: its picker reports the message through
   * `aria-describedby`, so the id has to exist for the reference to resolve. The others
   * sit directly under their control, where proximity is the whole mechanism.
   */
  readonly id?: string;
  readonly error: { readonly message?: string } | undefined;
}) {
  if (!error) return null;

  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  );
}

/**
 * The span a booking would cover, in the clinic's zone.
 *
 * Takes the wall clock the field holds rather than an instant, because that is what
 * the form has, and converts it here — the summary and the request are then derived
 * from one value, so the sentence in the header cannot describe a different hour than
 * the one that gets booked.
 *
 * `undefined` when there is no time yet, or when the clock the field holds is one the
 * zone skipped; both mean the same thing to a reader, which is "not a booking yet".
 *
 * The end is derived by adding the duration to the instant and formatting the pair,
 * rather than formatting the start and appending minutes to a string — a formatted
 * "09:00 plus 90 minutes" is a string operation that has to re-implement the
 * arithmetic the domain already does (ADR 0012). Crossing midnight and crossing a
 * daylight-saving change are both correct here for free, because the arithmetic
 * happens on instants.
 */
function formatChosenSpan(
  localStartsAt: string,
  durationMinutes: number,
  timeZone: string,
  locale: string,
): string | undefined {
  const startsAt = zonedWallClockToInstant(localStartsAt, timeZone);
  if (startsAt === undefined) {
    return undefined;
  }

  const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();

  return `${formatClinicDayTime(startsAt, timeZone, locale)} · ${formatClinicTimeRange(startsAt, endsAt, timeZone, locale)}`;
}
