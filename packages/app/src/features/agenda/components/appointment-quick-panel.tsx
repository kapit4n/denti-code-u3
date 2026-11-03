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
  addMinutes,
  allowedAppointmentTransitions,
  isScheduleEditable,
  type AgendaEntry,
  type AppointmentStatus,
} from '@denti-code-u3/domain';
import type { Clinic } from '@denti-code-u3/domain';

import { useTransitionAppointmentStatus } from '../mutations/use-transition-appointment-status.js';
import { useRescheduleAppointment } from '../mutations/use-reschedule-appointment.js';
import { describeAppointmentFailure } from '../describe-appointment-failure.js';
import {
  appointmentStatusClassName,
  appointmentStatusLabel,
  appointmentTransitionLabel,
  requiresTransitionReason,
} from '../appointment-status-presentation.js';
import { formatClinicDayTime, formatClinicTimeRange } from '../../clinic/format-clinic-time.js';
import { instantToZonedWallClock, zonedWallClockToInstant } from '../../clinic/zoned-wall-clock.js';
import { useTranslation } from '../../../i18n/index.js';
import { AppointmentProgressTimeline } from './appointment-progress-timeline.js';
import { AppointmentWallClockFields } from './appointment-wall-clock-fields.js';

export interface AppointmentQuickPanelProps {
  readonly entry: AgendaEntry;
  readonly clinic: Clinic;
  /** Called when the panel should go away: closed by hand, or after a write. */
  readonly onClose: () => void;
}

function wallClockParts(wallClock: string | undefined): { date: string; time: string } {
  const [date = '', time = ''] = wallClock?.split('T') ?? [];
  return { date, time };
}

export function AppointmentQuickPanel({ entry, clinic, onClose }: AppointmentQuickPanelProps) {
  const { locale, t } = useTranslation();
  const transition = useTransitionAppointmentStatus();
  const reschedule = useRescheduleAppointment();
  const [reason, setReason] = useState('');
  const [recording, setRecording] = useState<{
    readonly to: 'ARRIVED' | 'IN_TREATMENT';
    readonly date: string;
    readonly time: string;
  } | null>(null);
  const [moving, setMoving] = useState<{ readonly date: string; readonly time: string } | null>(
    null,
  );
  const [timeError, setTimeError] = useState<string | null>(null);
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
  const canReschedule = isScheduleEditable(entry.status);
  const busy = transition.isPending || reschedule.isPending;

  const failure = describeAppointmentFailure(transition.error ?? reschedule.error, {
    timeZone: clinic.timeZone,
    fallback: t('agenda.panel.updateError'),
    locale,
    messages: {
      conflict: t('agenda.failure.conflict'),
      conflictOne: t('agenda.failure.conflictOne'),
      conflictMany: t('agenda.failure.conflictMany'),
      notFound: t('agenda.failure.notFound'),
      network: t('agenda.failure.network'),
    },
  });

  const sendTransition = (to: AppointmentStatus, why?: string, occurredAt?: string) => {
    transition.mutate(
      {
        appointmentId: entry.id,
        to,
        ...(why ? { reason: why } : {}),
        ...(occurredAt ? { occurredAt } : {}),
      },
      {
        onSuccess: onClose,
      },
    );
  };

  const openRecording = (to: 'ARRIVED' | 'IN_TREATMENT') => {
    const now = wallClockParts(instantToZonedWallClock(new Date().toISOString(), clinic.timeZone));
    setTimeError(null);
    setRecording({ to, ...now });
  };

  const openReschedule = () => {
    const start = wallClockParts(instantToZonedWallClock(entry.startsAt, clinic.timeZone));
    setTimeError(null);
    setMoving(start);
  };

  const sendRecordedTransition = () => {
    if (!recording) return;
    const occurredAt = zonedWallClockToInstant(
      `${recording.date}T${recording.time}`,
      clinic.timeZone,
    );
    if (!occurredAt) {
      setTimeError(t('agenda.panel.invalidTime', { timeZone: clinic.timeZone }));
      return;
    }
    setTimeError(null);
    sendTransition(recording.to, undefined, occurredAt);
  };

  const sendReschedule = () => {
    if (!moving) return;
    const startsAt = zonedWallClockToInstant(`${moving.date}T${moving.time}`, clinic.timeZone);
    if (!startsAt) {
      setTimeError(t('agenda.panel.invalidTime', { timeZone: clinic.timeZone }));
      return;
    }
    setTimeError(null);
    reschedule.mutate({ appointmentId: entry.id, startsAt }, { onSuccess: onClose });
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
              {appointmentStatusLabel(t, entry.status)}
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
            <span className="sr-only sm:not-sr-only">{t('agenda.panel.when')}</span>
          </dt>
          <dd>
            {formatClinicDayTime(entry.startsAt, clinic.timeZone, locale)}
            <span className="block text-muted-foreground">
              {formatClinicTimeRange(entry.startsAt, entry.endsAt, clinic.timeZone, locale)} ·{' '}
              {t('agenda.duration', { count: entry.durationMinutes })}
            </span>
          </dd>

          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Stethoscope aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">{t('agenda.panel.dentist')}</span>
          </dt>
          <dd>{entry.dentistFullName ?? t('agenda.unassigned')}</dd>

          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">{t('agenda.panel.chair')}</span>
          </dt>
          <dd>{entry.chairName ?? t('agenda.noChair')}</dd>
        </dl>

        {entry.notes ? <p className="rounded-md bg-muted p-3 text-sm">{entry.notes}</p> : null}

        <AppointmentProgressTimeline appointmentId={entry.id} timeZone={clinic.timeZone} />

        {recording ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              {t('agenda.panel.recordTime', {
                action: appointmentTransitionLabel(t, entry.status, recording.to),
              })}
            </p>
            <AppointmentWallClockFields
              idPrefix="appointment-recording"
              dateLabel={t('agenda.panel.date')}
              timeLabel={t('agenda.panel.time')}
              date={recording.date}
              time={recording.time}
              disabled={busy}
              autoFocus
              onDateChange={(date) => setRecording({ ...recording, date })}
              onTimeChange={(time) => setRecording({ ...recording, time })}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const now = wallClockParts(
                  instantToZonedWallClock(new Date().toISOString(), clinic.timeZone),
                );
                setTimeError(null);
                setRecording({ ...recording, ...now });
              }}
            >
              {t('agenda.panel.useCurrentTime')}
            </Button>
            {timeError ? (
              <p role="alert" className="text-sm text-destructive">
                {timeError}
              </p>
            ) : null}
            {busy ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                {t('common.saving')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid="confirm-recording"
                disabled={busy || !recording.date || !recording.time}
                onClick={sendRecordedTransition}
              >
                {appointmentTransitionLabel(t, entry.status, recording.to)}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRecording(null);
                  setTimeError(null);
                }}
              >
                {t('agenda.panel.back')}
              </Button>
            </div>
          </div>
        ) : moving ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{t('agenda.panel.newTime')}</p>
            <AppointmentWallClockFields
              idPrefix="appointment-reschedule"
              dateLabel={t('agenda.panel.date')}
              timeLabel={t('agenda.panel.time')}
              date={moving.date}
              time={moving.time}
              disabled={busy}
              autoFocus
              onDateChange={(date) => setMoving({ ...moving, date })}
              onTimeChange={(time) => setMoving({ ...moving, time })}
            />
            {timeError ? (
              <p role="alert" className="text-sm text-destructive">
                {timeError}
              </p>
            ) : null}
            {busy ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                {t('common.saving')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                data-testid="confirm-reschedule"
                disabled={busy || !moving.date || !moving.time}
                onClick={sendReschedule}
              >
                {t('agenda.panel.moveAppointment')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setMoving(null);
                  setTimeError(null);
                }}
              >
                {t('agenda.panel.back')}
              </Button>
            </div>
          </div>
        ) : askingWhy ? (
          <div className="space-y-2">
            <Label htmlFor="appointment-cancel-reason">{t('agenda.panel.cancelReason')}</Label>
            <textarea
              id="appointment-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              autoFocus
              disabled={transition.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder={t('agenda.panel.cancelReasonPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('agenda.panel.cancelReasonHint')}</p>
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
                {t('agenda.panel.confirmCancellation')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={transition.isPending}
                onClick={() => setAskingWhy(false)}
              >
                {t('agenda.panel.keep')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {canReschedule ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{t('agenda.panel.reschedule')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="reschedule-30"
                    disabled={busy}
                    onClick={() =>
                      reschedule.mutate(
                        { appointmentId: entry.id, startsAt: addMinutes(entry.startsAt, 30) },
                        { onSuccess: onClose },
                      )
                    }
                  >
                    {t('agenda.panel.move30')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="reschedule-custom"
                    disabled={busy}
                    onClick={openReschedule}
                  >
                    {t('agenda.panel.chooseTime')}
                  </Button>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              {allowed.length === 0 ? (
                // Said out loud rather than shown as an empty row of buttons: a completed
                // appointment is history, and silence here reads as a panel that failed
                // to load.
                <p className="text-sm text-muted-foreground">{t('agenda.panel.finished')}</p>
              ) : (
                allowed.map((to) => (
                  <Button
                    key={to}
                    type="button"
                    variant={to === 'CANCELLED' ? 'outline' : 'default'}
                    disabled={busy}
                    data-testid={`transition-${to}`}
                    onClick={() => {
                      if (requiresTransitionReason(to)) {
                        setAskingWhy(true);
                        return;
                      }
                      if (to === 'ARRIVED' || to === 'IN_TREATMENT') {
                        openRecording(to);
                        return;
                      }
                      sendTransition(to);
                    }}
                  >
                    {appointmentTransitionLabel(t, entry.status, to)}
                  </Button>
                ))
              )}
              {busy ? (
                <p className="text-sm text-muted-foreground" role="status">
                  <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                  {t('common.saving')}
                </p>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
