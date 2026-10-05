/**
 * The quick panel: one appointment, and what may be done to it.
 *
 * Opened by clicking a block on the grid. It answers three questions and no more —
 * who is this, when are they coming, and what can I do right now — because the
 * alternative is a drawer that grows into a second patient chart.
 *
 * **It offers only moves the domain allows.** The buttons come from
 * `allowedAppointmentTransitions(entry.status)`, asked at render time, so the panel,
 * the API's use case and the patient chart cannot disagree about what a `COMPLETED`
 * appointment may still do. Nothing here decides legality: a completed visit has no
 * buttons because the domain says so, and the API would refuse them anyway.
 *
 * **It holds no copy of the appointment.** The entry is a prop, and after a
 * successful transition the panel closes: the refetch that follows the write is what
 * updates the grid, and a panel still showing the status it was opened with would be
 * the only screen in the app contradicting the server.
 *
 * Times are drawn in the clinic's zone, never the visitor's — see
 * `format-clinic-time.ts`. A panel that says 10:00 for a 09:00 booking is worse than
 * no panel.
 */

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from '@denti-code-u3/ui';
import { AlertCircle, CalendarClock, Loader2, Stethoscope, UserRound } from 'lucide-react';
import {
  allowedAppointmentTransitions,
  type AgendaEntry,
  type AppointmentStatus,
} from '@denti-code-u3/domain';
import type { Clinic } from '@denti-code-u3/domain';

import { useTransitionAppointmentStatus } from '../mutations/use-transition-appointment-status.js';
import { describeAppointmentFailure } from '../describe-appointment-failure.js';
import {
  appointmentStatusClassName,
  appointmentStatusLabel,
  appointmentTransitionLabel,
  requiresTransitionReason,
} from '../appointment-status-presentation.js';
import { formatClinicDayTime, formatClinicTimeRange } from '../../clinic/format-clinic-time.js';

export interface AppointmentQuickPanelProps {
  readonly entry: AgendaEntry;
  readonly clinic: Clinic;
  /** Called when the panel should go away: closed by hand, or after a write. */
  readonly onClose: () => void;
}

export function AppointmentQuickPanel({ entry, clinic, onClose }: AppointmentQuickPanelProps) {
  const transition = useTransitionAppointmentStatus();
  const [reason, setReason] = useState('');
  /**
   * Whether the panel is asking why before it cancels.
   *
   * Two steps on purpose. Every cancellable status can be cancelled, so a reason field
   * that was simply present would sit under "Check in" on almost every appointment,
   * asking for an explanation nobody is about to give. And a cancellation is the one
   * move here that cannot be undone by re-booking the same slot, so it should not be
   * one click away from a field the user has not filled in.
   */
  const [askingWhy, setAskingWhy] = useState(false);

  const allowed = allowedAppointmentTransitions(entry.status);

  const failure = describeAppointmentFailure(transition.error, {
    timeZone: clinic.timeZone,
    fallback: 'The appointment could not be updated.',
  });

  const sendTransition = (to: AppointmentStatus, why?: string) => {
    transition.mutate(
      {
        appointmentId: entry.id,
        to,
        // Sent only when there is one. An empty string is not "no reason": the domain
        // checks for a reason's presence, and `''` would sail past that check and
        // record a cancellation with a blank explanation.
        ...(why ? { reason: why } : {}),
      },
      {
        onSuccess: onClose,
      },
    );
  };

  return (
    <Dialog
      open
      // Escape and the overlay both mean the same thing here: stop looking at this
      // appointment. A dismissal is never a cancellation — that is a button, with a
      // reason attached, because "I looked at it and closed the panel" must not be
      // able to end up in the record.
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-labelledby="quick-panel-title" data-testid="appointment-quick-panel">
        <DialogHeader>
          <DialogTitle id="quick-panel-title">
            {entry.patientFirstName} {entry.patientLastName}
          </DialogTitle>
          <DialogDescription>
            <span
              className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${appointmentStatusClassName(entry.status)}`}
            >
              {appointmentStatusLabel(entry.status)}
            </span>
          </DialogDescription>
        </DialogHeader>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 text-sm">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarClock aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">When</span>
          </dt>
          <dd>
            {formatClinicDayTime(entry.startsAt, clinic.timeZone)}
            <span className="block text-muted-foreground">
              {formatClinicTimeRange(entry.startsAt, entry.endsAt, clinic.timeZone)} ·{' '}
              {entry.durationMinutes} min
            </span>
          </dd>

          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Stethoscope aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">Dentist</span>
          </dt>
          <dd>{entry.dentistFullName ?? 'Unassigned'}</dd>

          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">Chair</span>
          </dt>
          <dd>{entry.chairName ?? 'No chair assigned'}</dd>
        </dl>

        {entry.notes ? <p className="rounded-md bg-muted p-3 text-sm">{entry.notes}</p> : null}

        {/*
          The reason is asked for only after "Cancel" has been chosen, and the panel
          then offers nothing else: one decision on screen at a time, and a destructive
          move that is two deliberate steps rather than one.
        */}
        {askingWhy ? (
          <div className="space-y-2">
            <Label htmlFor="appointment-cancel-reason">Why is it being cancelled?</Label>
            <textarea
              id="appointment-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              autoFocus
              disabled={transition.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="The patient called to cancel"
            />
            <p className="text-xs text-muted-foreground">
              A cancellation is kept in the record. This is what the desk reads when the patient
              calls back.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                data-testid="confirm-cancellation"
                // Disabled rather than sending an empty reason: the domain demands one,
                // and a 422 naming a field is a worse answer than a button that will
                // not press.
                disabled={transition.isPending || reason.trim().length === 0}
                onClick={() => sendTransition('CANCELLED', reason.trim())}
              >
                Cancel the appointment
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={transition.isPending}
                onClick={() => setAskingWhy(false)}
              >
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            {allowed.length === 0 ? (
              // Said out loud rather than shown as an empty row of buttons: a completed
              // appointment is history, and silence here reads as a panel that failed
              // to load.
              <p className="text-sm text-muted-foreground">
                This appointment is finished. Its record is kept as it is.
              </p>
            ) : (
              allowed.map((to) => (
                <Button
                  key={to}
                  type="button"
                  variant={to === 'CANCELLED' ? 'outline' : 'default'}
                  disabled={transition.isPending}
                  data-testid={`transition-${to}`}
                  onClick={() => {
                    if (requiresTransitionReason(to)) {
                      setAskingWhy(true);
                      return;
                    }
                    sendTransition(to);
                  }}
                >
                  {appointmentTransitionLabel(entry.status, to)}
                </Button>
              ))
            )}
            {transition.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
