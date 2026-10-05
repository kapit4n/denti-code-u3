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
 * Read-only for now: clicking, dragging and resizing arrive with the write side, and
 * none of them are stubbed here, because a control that looks live and is not is
 * worse than an absent one.
 */

import { useCallback, useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import luxonPlugin from '@fullcalendar/luxon3';
import type { DatesSetArg } from '@fullcalendar/core';
import type { Clinic } from '@denti-code-u3/domain';
import { AlertCircle, CalendarDays } from 'lucide-react';

import { useAgendaRange, type AgendaRange } from '../queries/agenda-range-query.js';
import { toCalendarEvents } from '../adapters/to-calendar-event.js';
import { toBusinessHours, toScrollTime } from '../adapters/to-business-hours.js';

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

  const { data, isPending, error } = useAgendaRange(range);
  const events = useMemo(() => toCalendarEvents(data?.items ?? []), [data]);

  const handleDatesSet = useCallback((arg: DatesSetArg) => {
    // `start`/`end` are the instants bounding the visible range, in the calendar's
    // own zone. `.toISOString()` converts to the UTC ISO string the API expects; the
    // half-open convention means the block ending exactly at `to` belongs to the
    // next window, which is what the API's `[from, to)` does with it.
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
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
          plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin]}
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

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden />
          The agenda could not be loaded.
        </p>
      )}

      {!isPending && !error && events.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden />
          No appointments in this range.
        </p>
      )}
    </section>
  );
}
