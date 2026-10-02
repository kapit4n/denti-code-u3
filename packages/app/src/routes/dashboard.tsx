import { createFileRoute } from '@tanstack/react-router';
import { Calendar, CheckCircle, Clock, XCircle, Users, DollarSign } from 'lucide-react';
import { StatCard, QuickActions, TodayAppointments } from '../features/dashboard/index.js';
import { useDashboardStats } from '../features/dashboard/hooks/use-dashboard-stats.js';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard(): React.ReactNode {
  const greeting = getGreeting();
  const { data: stats, isLoading } = useDashboardStats();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{greeting}</h1>
          <p className="text-muted-foreground">What is happening today?</p>
        </div>
        <QuickActions />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Appointments"
          value={isLoading ? '...' : (stats?.appointments ?? 0)}
          description="Today"
          icon={Calendar}
        />
        <StatCard
          title="Completed"
          value={isLoading ? '...' : (stats?.completed ?? 0)}
          description="Today"
          icon={CheckCircle}
        />
        <StatCard
          title="Pending"
          value={isLoading ? '...' : (stats?.pending ?? 0)}
          description="Today"
          icon={Clock}
        />
        <StatCard
          title="Cancelled"
          value={isLoading ? '...' : (stats?.cancelled ?? 0)}
          description="Today"
          icon={XCircle}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TodayAppointments />
        </div>
        <div className="space-y-4">
          <StatCard
            title="Total Patients"
            value={isLoading ? '...' : (stats?.totalPatients ?? 0)}
            icon={Users}
          />
          <StatCard
            title="Revenue"
            value={isLoading ? '...' : `$${(stats?.revenue ?? 0).toFixed(2)}`}
            description="This month"
            icon={DollarSign}
          />
          <StatCard
            title="Pending Treatments"
            value={isLoading ? '...' : (stats?.pendingTreatments ?? 0)}
          />
          <StatCard
            title="Occupancy Rate"
            value={isLoading ? '...' : `${(stats?.occupancyRate ?? 0).toFixed(0)}%`}
          />
        </div>
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
