/**
 * The agenda calendar.
 *
 * The one component allowed to know FullCalendar exists (ADR 0011). It arranges the
 * pieces and owns nothing else: the range it is drawing comes from FullCalendar's own
 * `datesSet`, the events come from the adapter, and the timezone comes from the
 * clinic's record. There is no scheduling logic here — no overlap check, no duration
 * rule, no "is this slot free" — because the API and the domain are the authority on
 * those. A calendar that decided them itself would answer differently from the API
 * the moment the two drifted.
 *
 * **Timezone.** The clinic's IANA zone is passed to FullCalendar along with the
 * luxon3 plugin; without that plugin FullCalendar silently falls back to UTC
 * coercion for named zones, and a Lima clinic's 09:00 would be drawn at 04:00. The
 * API already resolved "today" against the same zone, so the grid and the query
 * agree about which day it is.
 *
 * **Business hours** come from the clinic's opening hours rather than a constant, so
 * the shaded non-working region is the clinic's own.
 *
 * **Writes.** Three gestures, and none of them decides anything about the schedule:
 * a drag and a resize are read by `from-calendar-event.ts` into a domain intent and
 * sent to the API, and a click opens the quick panel. The grid keeps the block where
 * it was dropped while the request is in flight — that is FullCalendar's own
 * feedback, not a second source of truth — and reverts it if the server refuses,
 * which is what happens when two receptionists take the same slot. There is no
 * `eventOverlap` check and no "is that hour free" test here: those rules belong to
 * the domain and the database, and a client that pre-judged them would answer
 * differently from the server and then disagree with it in front of the user.
 */

import { useCallback, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import luxonPlugin from '@fullcalendar/luxon3';
// The interaction plugin is what makes a block draggable, stretchable and clickable;
// the time-grid plugin draws the grid and knows nothing about gestures. `editable`,
// `eventDrop` and `eventResize` are its options, so without it the grid renders and
// every one of those props is rejected by the type checker rather than quietly ignored.
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg } from '@fullcalendar/core';
import type { AgendaEntry, Clinic } from '@denti-code-u3/domain';
import { AlertCircle, CalendarDays } from 'lucide-react';

import { useAgendaRange, type AgendaRange } from '../queries/agenda-range-query.js';
import { useRescheduleAppointment } from '../mutations/use-reschedule-appointment.js';
import { toRescheduleIntent, type CalendarEventChange } from '../adapters/from-calendar-event.js';
import { agendaEntryFromEvent, toCalendarEvents } from '../adapters/to-calendar-event.js';
import { toBusinessHours, toScrollTime } from '../adapters/to-business-hours.js';
import { describeAppointmentFailure } from '../describe-appointment-failure.js';
import { AppointmentQuickPanel } from './appointment-quick-panel.js';

export interface AgendaCalendarProps {
  readonly clinic: Clinic;
}

export function AgendaCalendar({ clinic }: AgendaCalendarProps) {
  /**
   * The window on screen, reported by the calendar itself.
   *
   * Held in state rather than derived from a date picker because the grid knows what
   * it is showing — including a week view's start and a month view's leading days —
   * and a second opinion about which days those are is how a grid ends up showing
   * events that were never fetched. `datesSet` fires on mount and after every
   * navigation, and before the first call there is deliberately no range: the query
   * stays disabled rather than asking for an empty window.
   */
  const [range, setRange] = useState<AgendaRange | undefined>(undefined);

  /** The appointment the quick panel is showing, or none. */
  const [selected, setSelected] = useState<AgendaEntry | undefined>(undefined);

  /**
   * The last refused write, in a sentence.
   *
   * Held here rather than in the mutation because a rejected drag has no panel to live
   * in: the block springs back to where it was, and a message the user cannot see is
   * the same as no message at all.
   */
  const [writeFailure, setWriteFailure] = useState<string | undefined>(undefined);

  const { data, isPending, error } = useAgendaRange(range);
  const reschedule = useRescheduleAppointment();
  const events = useMemo(() => toCalendarEvents(data?.items ?? []), [data]);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    // `start`/`end` are the instants bounding the visible range, in the calendar's
    // own zone. `.toISOString()` converts to the UTC ISO string the API expects; the
    // half-open convention means the block ending exactly at `to` belongs to the
    // next window, which is what the API's `[from, to)` does with it.
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
  }, []);

  /**
   * A drag or a resize, as a reschedule request.
   *
   * `revert` puts the block back. It is called only when the server refuses, because
   * a successful write is followed by the invalidation that redraws the grid from the
   * server's answer — and calling it on success would make the grid jump back and
   * forward while the refetch was in flight.
   */
  const handleScheduleChange = useCallback(
    (change: CalendarEventChange, revert: () => void) => {
      const intent = toRescheduleIntent(change);
      if (!intent) {
        // The block was dropped back where it was, or it is not one of ours. Nothing
        // to ask the API, and nothing to report.
        return;
      }

      setWriteFailure(undefined);
      reschedule.mutate(intent, {
        onError: (failure: unknown) => {
          revert();
          setWriteFailure(
            describeAppointmentFailure(failure, {
              timeZone: clinic.timeZone,
              fallback: 'The appointment could not be moved.',
            }),
          );
        },
      });
    },
    [clinic.timeZone, reschedule],
  );

  /**
   * A clicked block opens the quick panel.
   *
   * Read back through the adapter rather than by parsing the title: the entry travels
   * with the event precisely so this does not have to guess. A block with no entry —
   * one this app did not draw — selects nothing and opens nothing, rather than opening
   * a panel about `undefined`.
   */
  const handleEventClick = useCallback((click: EventClickArg) => {
    setSelected(agendaEntryFromEvent(click.event));
  }, []);

  return (
    <section aria-label="Agenda" className="flex flex-col gap-3">
      <div
        className="relative min-h-[40rem]"
        // FullCalendar renders a plain div and takes over the subtree, so it cannot
        // be labelled from JSX attributes on the wrapper alone. `aria-label` here is
        // what a screen reader announces for the region.
        aria-busy={isPending}
      >
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin, interactionPlugin]}
          initialView="timeGridDay"
          views={{
            timeGridDay: { type: 'timeGridDay', buttonText: 'Day' },
            timeGridWeek: { type: 'timeGridWeek', buttonText: 'Week' },
            dayGridMonth: { type: 'dayGridMonth', buttonText: 'Month' },
          }}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          timeZone={clinic.timeZone}
          events={events}
          datesSet={handleDatesSet}
          businessHours={toBusinessHours(clinic)}
          scrollTime={toScrollTime(clinic)}
          nowIndicator
          allDaySlot={false}
          // The switch that makes the grid writable at all. *Which* blocks may move
          // is answered per event, by the adapter, from the domain's
          // `isScheduleEditable` — so a cancelled block on Monday does not disable
          // Tuesday's morning, and a patient who has already arrived cannot be dragged
          // to a nicer hour.
          editable
          eventDrop={(arg) => handleScheduleChange(arg, arg.revert)}
          eventResize={(arg) => handleScheduleChange(arg, arg.revert)}
          eventClick={handleEventClick}
          slotMinTime="06:00:00"
          slotMaxTime="21:00:00"
          height="auto"
          expandRows
          eventMinHeight={24}
          // The clinic's non-working hours are shaded by `businessHours`; this
          // removes FullCalendar's default Saturday/Sunday weekend shading, which
          // is a guess about a clinic's week that belongs to the clinic's record.
          weekends={false}
        />

        {isPending && (
          <p
            className="absolute right-3 top-3 rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
            role="status"
          >
            Loading…
          </p>
        )}
      </div>

      {/*
        One alert, and a refused write takes precedence over a failed load: it is the
        newer fact, and it is the one the receptionist has to act on. The grid is
        already showing the load failure in the sense that it is empty, and saying
        both at once reads as two problems where there is one.
      */}
      {writeFailure ? (
        <p
          className="flex items-center gap-2 text-sm text-destructive"
          role="alert"
          data-testid="schedule-write-failure"
        >
          <AlertCircle className="h-4 w-4" aria-hidden />
          {writeFailure}
        </p>
      ) : error ? (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden />
          The agenda could not be loaded.
        </p>
      ) : null}

      {!isPending && !error && events.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden />
          No appointments in this range.
        </p>
      )}

      {/*
        Mounted only while an appointment is selected, so it opens on a click rather
        than on a click plus an effect that has to notice. The entry is a prop and not
        a copy, and the panel closes once the server agrees — which is what keeps it
        from showing a status the API has already superseded, since the refetch that
        follows the write never reaches a component that is no longer mounted.
      */}
      {selected ? (
        <AppointmentQuickPanel
          entry={selected}
          clinic={clinic}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}
