/**
 * The dashboard: "what is happening today?".
 *
 * Assembled entirely from API queries. There is no local arithmetic on any
 * metric — the counts arrive grouped (today / clinic) and money arrives in minor
 * units, formatted once through the domain's `formatMinorUnits`. A dashboard
 * that recomputes a figure is a second source of truth for it, and the two
 * inevitably disagree.
 *
 * It also owns the "New Visit" dialog, because that button is here and the booking
 * rules are not: the dialog is the agenda's, opened from the dashboard with no slot
 * and no patient. Holding the open/closed state here rather than in the button keeps
 * the dashboard's list of actions free of state, and puts the dialog where the person
 * who opened it is standing.
 *
 * The accents are the only thing that changed about the metrics in the redesign:
 * the titles, values and data sources are exactly as they were, because the e2e specs
 * assert them by test id and a recolour must not be able to move a number.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { formatMinorUnits } from '@denti-code-u3/domain';
import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ClipboardList,
  Clock,
  DollarSign,
  Gauge,
  Stethoscope,
  Users,
} from 'lucide-react';

import { AppointmentBookingDialog } from '../features/agenda/components/appointment-booking-dialog.js';
import { useClinicSettings } from '../features/clinic/queries/clinic-settings-query.js';
import { CalendarPreview } from '../features/dashboard/components/calendar-preview.js';
import { QuickActions } from '../features/dashboard/components/quick-actions.js';
import { QuickActionsPanel } from '../features/dashboard/components/quick-actions-panel.js';
import { RecentPatients } from '../features/dashboard/components/recent-patients.js';
import { StatCard } from '../features/dashboard/components/stat-card.js';
import { TodayAppointments } from '../features/dashboard/components/today-appointments.js';
import { UpcomingVisits } from '../features/dashboard/components/upcoming-visits.js';
import { useDashboardStats } from '../features/dashboard/hooks/use-dashboard-stats.js';
import { useTranslation } from '../i18n/index.js';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data, isPending, error } = useDashboardStats();
  // The booking dialog needs the clinic, and nothing else on this page does — so this is
  // the first time the dashboard asks who the clinic is. It was answered on the agenda
  // already, and cached for the life of the tab. Named `clinicRecord` because `clinic`
  // below is the dashboard's own bucket of counts, which is a different thing entirely.
  const { data: clinicRecord } = useClinicSettings();
  const [isBooking, setIsBooking] = useState(false);

  const today = data?.today;
  const clinic = data?.clinic;
  const loading = isPending;
  const failed = error ?? null;

  // The greeting names the clinic, not a user: authentication does not exist, so
  // there is no person whose name this page has any right to claim. The clinic's
  // own name is real data and reads as a welcome rather than an assertion about
  // who is logged in.
  const subtitle = clinicRecord?.name
    ? t('dashboard.subtitle.withClinic', { clinic: clinicRecord.name })
    : t('dashboard.subtitle.withoutClinic');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting(t)}</h1>
          <p className="mt-1 text-muted-foreground">{subtitle}</p>
        </div>
        <QuickActions onNewVisit={() => setIsBooking(true)} />
      </header>

      <section
        aria-label={t('dashboard.section.todayAppointments')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
      >
        <StatCard
          title={t('dashboard.stats.appointments.title')}
          testId="Appointments"
          value={today?.appointments ?? 0}
          description={t('dashboard.stats.appointments.description')}
          icon={CalendarDays}
          accent="blue"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.completed.title')}
          testId="Completed"
          value={today?.completed ?? 0}
          description={t('dashboard.stats.completed.description')}
          icon={CheckCircle2}
          accent="green"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.pending.title')}
          testId="Pending"
          value={today?.pending ?? 0}
          description={t('dashboard.stats.pending.description')}
          icon={Clock}
          accent="amber"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.inTreatment.title')}
          testId="In treatment"
          value={today?.inTreatment ?? 0}
          description={t('dashboard.stats.inTreatment.description')}
          icon={Stethoscope}
          accent="violet"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.cancelled.title')}
          testId="Cancelled"
          value={today?.cancelled ?? 0}
          description={t('dashboard.stats.cancelled.description')}
          icon={CircleSlash}
          accent="rose"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.noShow.title')}
          testId="No-show"
          value={today?.noShow ?? 0}
          description={t('dashboard.stats.noShow.description')}
          icon={CircleDashed}
          accent="slate"
          isLoading={loading}
          error={failed}
        />
      </section>

      <section
        aria-label={t('dashboard.section.clinicStatistics')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          title={t('dashboard.stats.activePatients.title')}
          testId="Active patients"
          value={clinic?.activePatients ?? 0}
          description={t('dashboard.stats.activePatients.description')}
          icon={Users}
          accent="blue"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.collected.title')}
          testId="Collected this month"
          value={
            clinic
              ? `${formatMinorUnits(clinic.collectedThisMonthMinor)}${
                  clinic.currencyCode ? ` ${clinic.currencyCode}` : ''
                }`
              : '0.00'
          }
          description={t('dashboard.stats.collected.description')}
          icon={DollarSign}
          accent="green"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.pendingTreatments.title')}
          testId="Pending treatments"
          value={clinic?.pendingTreatmentItems ?? 0}
          description={t('dashboard.stats.pendingTreatments.description')}
          icon={ClipboardList}
          accent="amber"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title={t('dashboard.stats.occupancy.title')}
          testId="Occupancy"
          // `null` means the API could not determine today's capacity, which is
          // not the same as an empty clinic.
          value={
            clinic?.occupancyRate === null || clinic?.occupancyRate === undefined
              ? '—'
              : `${clinic.occupancyRate}%`
          }
          description={t('dashboard.stats.occupancy.description')}
          icon={Gauge}
          accent="violet"
          isLoading={loading}
          error={failed}
          isUnknown={clinic?.occupancyRate === null}
        />
      </section>

      <section aria-label={t('dashboard.section.schedule')} className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <TodayAppointments />
          <CalendarPreview />
          <QuickActionsPanel />
        </div>
        <div className="flex flex-col gap-6">
          <RecentPatients />
          <UpcomingVisits />
        </div>
      </section>

      {/* Both doors, one dialog: no slot (this is not a grid) and no patient (nobody has
          been named yet), so it asks for both. It closes itself once the API agrees and
          the dashboard's own queries refetch — nothing here is inserted optimistically,
          so "today's" numbers change only when the server says they did. */}
      {isBooking && clinicRecord ? (
        <AppointmentBookingDialog clinic={clinicRecord} onClose={() => setIsBooking(false)} />
      ) : null}
    </div>
  );
}

/** Time-of-day greeting. Cosmetic only; drives no behaviour. */
function greeting(t: ReturnType<typeof useTranslation>['t']): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('dashboard.greeting.morning');
  if (hour < 18) return t('dashboard.greeting.afternoon');
  return t('dashboard.greeting.evening');
}
