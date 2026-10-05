/**
 * The booking dialog: a slot, and who is coming to it.
 *
 * Opened by clicking an empty slot on the grid. **The grid is the time picker**: the
 * click is the choice of when, and this dialog asks only who, for how long and in
 * which chair. There is deliberately no time input here — a second control for the
 * same decision is a second opinion about it, and the grid already answers it by
 * direct manipulation. To move an appointment later, drag it; to book a different
 * hour, close this and click that one.
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
  /** The clicked slot, as an ISO instant. Never a local date-time. */
  readonly startsAt: string;
  readonly clinic: Clinic;
  readonly onClose: () => void;
  /** Called after the API agrees, with the row the booking became. */
  readonly onBooked?: (entry: { readonly id: string }) => void;
}

export function AppointmentBookingDialog({
  startsAt,
  clinic,
  onClose,
  onBooked,
}: AppointmentBookingDialogProps) {
  const create = useCreateAppointment();
  const dentists = useDentists();
  const chairs = useChairs();

  /**
   * The chosen patient's name, held beside the id in the form.
   *
   * Not a field of the form because it is not sent to the API — a booking names a
   * patient by id, and a label travelling in the body would be a second thing the
   * server would have to ignore.
   */
  const [patientLabel, setPatientLabel] = useState<string | undefined>(undefined);

  const form = useForm<CreateAppointmentFormValues, unknown, CreateAppointmentFormOutput>({
    resolver: zodResolver(createAppointmentFormSchema),
    defaultValues: {
      patientId: '',
      dentistId: '',
      // Pre-filled strings rather than `undefined`, for the reason the patient form
      // gives: a controlled input starting as `undefined` flickers on first render.
      chairId: '',
      startsAt,
      durationMinutes: DEFAULT_DURATION_MINUTES,
      notes: '',
    },
  });

  const durationMinutes = form.watch('durationMinutes');
  const patientId = form.watch('patientId');

  /**
   * When this booking would be, in the clinic's own words.
   *
   * Recomputed as the duration changes, so the dialog shows the span that is about to
   * be booked rather than the slot that was clicked — which, after a 90-minute
   * choice, is not the same hour. `formatClinicTimeRange` takes instants, so the end
   * is computed the same way the domain computes it (ADR 0012) rather than by adding
   * minutes to a formatted string.
   */
  const span = formatBookedSpan(startsAt, durationMinutes, clinic.timeZone);

  const onSubmit = form.handleSubmit((values) => {
    // The values as they are: the chair is absent here because the dropdown mapped
    // "no chair" to an empty string, which the schema turns into an absent field.
    // Nothing is converted again on the way out.
    create.mutate(values, {
      onSuccess: (entry) => {
        onBooked?.(entry);
        onClose();
      },
    });
  });

  const failure = describeAppointmentFailure(create.error, {
    timeZone: clinic.timeZone,
    fallback: 'The appointment could not be booked.',
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
          <DialogTitle id="booking-dialog-title">New appointment</DialogTitle>
          <DialogDescription>{span}</DialogDescription>
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
              Clinician<span aria-hidden> *</span>
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
                <SelectValue placeholder="Choose a clinician" />
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
                Loading clinicians…
              </p>
            ) : null}
            {!dentists.isPending && (dentists.data?.items.length ?? 0) === 0 ? (
              // Said out loud rather than showing an empty dropdown: a clinic with no
              // active clinician cannot book anything, and a silent select looks like a
              // form that has not loaded.
              <p className="text-xs text-muted-foreground">
                This clinic has no active clinician, so nothing can be booked yet.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="booking-duration">Duration</Label>
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
                      {minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="booking-chair">Chair</Label>
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
                  <SelectValue placeholder="No chair" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHAIR}>No chair</SelectItem>
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
            <Label htmlFor="booking-notes">Notes</Label>
            <textarea
              id="booking-notes"
              rows={2}
              disabled={create.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="What the clinician should know before the patient arrives"
              {...form.register('notes')}
            />
            <FieldError error={form.formState.errors.notes} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending} data-testid="booking-submit">
              {create.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Booking…
                </>
              ) : (
                'Book appointment'
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
          </DialogFooter>
        </form>

        {loadingResources ? (
          <p className="text-xs text-muted-foreground" role="status">
            Loading the clinicians and chairs…
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
 * The end is derived by adding the duration to the instant and formatting the pair,
 * rather than formatting the start and appending minutes to a string — a formatted
 * "09:00 plus 90 minutes" is a string operation that has to re-implement the
 * arithmetic the domain already does (ADR 0012). Crossing midnight and crossing a
 * daylight-saving change are both correct here for free, because the arithmetic
 * happens on instants.
 */
function formatBookedSpan(startsAt: string, durationMinutes: number, timeZone: string): string {
  const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();

  return `${formatClinicDayTime(startsAt, timeZone)} · ${formatClinicTimeRange(startsAt, endsAt, timeZone)}`;
}
