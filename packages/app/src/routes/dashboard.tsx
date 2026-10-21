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

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard() {
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
    ? `Here’s what’s happening at ${clinicRecord.name} today.`
    : 'Here’s what’s happening at your clinic today.';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting()}</h1>
          <p className="mt-1 text-muted-foreground">{subtitle}</p>
        </div>
        <QuickActions onNewVisit={() => setIsBooking(true)} />
      </header>

      <section
        aria-label="Today's appointments"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6"
      >
        <StatCard
          title="Appointments"
          value={today?.appointments ?? 0}
          description="Booked today"
          icon={CalendarDays}
          accent="blue"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Completed"
          value={today?.completed ?? 0}
          description="Finished today"
          icon={CheckCircle2}
          accent="green"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Pending"
          value={today?.pending ?? 0}
          description="Awaiting the patient"
          icon={Clock}
          accent="amber"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="In treatment"
          value={today?.inTreatment ?? 0}
          description="Currently in the chair"
          icon={Stethoscope}
          accent="violet"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Cancelled"
          value={today?.cancelled ?? 0}
          description="Today"
          icon={CircleSlash}
          accent="rose"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="No-show"
          value={today?.noShow ?? 0}
          description="Today"
          icon={CircleDashed}
          accent="slate"
          isLoading={loading}
          error={failed}
        />
      </section>

      <section aria-label="Clinic statistics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active patients"
          value={clinic?.activePatients ?? 0}
          description="Registered in this clinic"
          icon={Users}
          accent="blue"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Collected this month"
          value={
            clinic
              ? `${formatMinorUnits(clinic.collectedThisMonthMinor)}${
                  clinic.currencyCode ? ` ${clinic.currencyCode}` : ''
                }`
              : '0.00'
          }
          description="Payments received"
          icon={DollarSign}
          accent="green"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Pending treatments"
          value={clinic?.pendingTreatmentItems ?? 0}
          description="Items not yet completed"
          icon={ClipboardList}
          accent="amber"
          isLoading={loading}
          error={failed}
        />
        <StatCard
          title="Occupancy"
          // `null` means the API could not determine today's capacity, which is
          // not the same as an empty clinic.
          value={
            clinic?.occupancyRate === null || clinic?.occupancyRate === undefined
              ? '—'
              : `${clinic.occupancyRate}%`
          }
          description="Booked share of today's capacity"
          icon={Gauge}
          accent="violet"
          isLoading={loading}
          error={failed}
          isUnknown={clinic?.occupancyRate === null}
        />
      </section>

      <section aria-label="Schedule" className="grid gap-6 lg:grid-cols-3">
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
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
