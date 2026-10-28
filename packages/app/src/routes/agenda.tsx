/**
 * The agenda: the clinic's book as a calendar.
 *
 * The route does three things and delegates everything else: it asks who the clinic
 * is, hands the calendar the clinic's timezone and opening hours, and reports the
 * states the user can act on. It holds no schedule state of its own, and it decides
 * nothing about appointments — see `agenda-calendar.tsx` for why the grid is not
 * where those decisions live.
 *
 * The clinic's settings load first because the grid cannot be drawn without them. A
 * calendar rendered in the visitor's own timezone would draw the wrong hours, and a
 * grid that silently used the browser's zone is a bug nobody reports until a
 * receptionist books the wrong patient into the wrong chair.
 */

import { createFileRoute } from '@tanstack/react-router';
import { AlertCircle, CalendarDays } from 'lucide-react';

import { AgendaCalendar } from '../features/agenda/components/agenda-calendar.js';
import { useClinicSettings } from '../features/clinic/queries/clinic-settings-query.js';
import { useTranslation } from '../i18n/index.js';

export const Route = createFileRoute('/agenda')({
  component: Agenda,
});

function Agenda() {
  const { t } = useTranslation();
  const { data: clinic, isPending, error } = useClinicSettings();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('agenda.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {clinic ? `${clinic.name} · ${clinic.timeZone}` : t('agenda.loadingClinic')}
        </p>
      </header>

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <CalendarDays className="h-4 w-4" aria-hidden />
          {t('agenda.loadingClinic')}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden />
          {t('agenda.clinicError')}
        </p>
      )}

      {clinic && <AgendaCalendar clinic={clinic} />}
    </div>
  );
}
