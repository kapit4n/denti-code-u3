/**
 * The patient profile: the central clinical context (Milestone 4).
 *
 * The file is named `patients_.$patientId` rather than living in a
 * `patients/$patientId` folder: the underscore opts this route out of nesting, so
 * the list and the profile are sibling pages. Nested, the list would have to
 * render an `<Outlet />` and the profile would appear inside it.
 *
 * One request returns the record plus everything a clinician needs on open —
 * allergies, the next appointment, recent visits, outstanding treatments and the
 * balance — because a profile assembled from five requests is a profile that
 * renders half-empty in practice.
 *
 * Every figure is rendered as the API computed it. The balance is formatted with
 * the domain's `formatMinorUnits` (integer arithmetic), never by dividing in the
 * component.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { formatMinorUnits } from '@denti-code-u3/domain';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
} from '@denti-code-u3/ui';
import { ArrowLeft } from 'lucide-react';

import { usePatient } from '../features/patients/hooks/use-patients.js';

export const Route = createFileRoute('/patients_/$patientId')({
  component: PatientProfile,
});

function PatientProfile() {
  const { patientId } = Route.useParams();
  const { data: patient, isPending, error } = usePatient(patientId);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading patient…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-destructive">
          {error instanceof Error && 'status' in error && error.status === 404
            ? 'This patient does not exist in the current clinic.'
            : 'The patient record could not be loaded.'}
        </p>
        <BackToList />
      </div>
    );
  }

  if (!patient) {
    return <p className="text-sm text-muted-foreground">No patient selected.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <BackToList />
        <h1 className="text-3xl font-bold tracking-tight">
          {patient.preferredName ?? `${patient.firstName} ${patient.lastName}`}
        </h1>
        <p className="text-muted-foreground">
          {patient.recordNumber ? `${patient.recordNumber} · ` : ''}
          {patient.isActive ? 'Active patient' : 'Inactive patient'}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Phone: {patient.phone ?? '—'}</p>
            <p>Email: {patient.email ?? '—'}</p>
            <p>Born: {patient.birthDate ?? '—'}</p>
            <p>Record created: {formatDate(patient.createdAt)}</p>
          </CardContent>
        </Card>

        {/* Allergies are safety-critical, so they get their own card and are
            never collapsed into a generic "medical history" line. */}
        <Card className={patient.allergies ? 'border-destructive/50' : undefined}>
          <CardHeader>
            <CardTitle>Allergies</CardTitle>
            <CardDescription>Read before any treatment</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {patient.allergies ? (
              <p className="font-medium text-destructive">{patient.allergies}</p>
            ) : (
              <p className="text-muted-foreground">None recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
            <CardDescription>Billed minus paid</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {/*
              A negative balance is a prepayment, not a debt. Showing it as
              "-80.00" would read as money the patient owes, which is the
              opposite of what happened.
            */}
            {patient.financialBalance.outstandingMinor < 0 ? (
              <p className="text-lg font-semibold">
                Credit {formatMinorUnits(Math.abs(patient.financialBalance.outstandingMinor))}
                {patient.financialBalance.currencyCode
                  ? ` ${patient.financialBalance.currencyCode}`
                  : ''}
              </p>
            ) : (
              <p className="text-lg font-semibold">
                {formatMinorUnits(patient.financialBalance.outstandingMinor)}
                {patient.financialBalance.currencyCode
                  ? ` ${patient.financialBalance.currencyCode}`
                  : ''}
              </p>
            )}
            <p className="text-muted-foreground">
              {patient.financialBalance.chargeCount} charge
              {patient.financialBalance.chargeCount === 1 ? '' : 's'} on record
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next appointment</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {patient.upcomingAppointment ? (
            <p>
              {formatDateTime(patient.upcomingAppointment.startsAt)} ·{' '}
              {patient.upcomingAppointment.durationMinutes} min ·{' '}
              {patient.upcomingAppointment.status}
            </p>
          ) : (
            <p className="text-muted-foreground">Nothing booked.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent visits</CardTitle>
          </CardHeader>
          <CardContent>
            {patient.recentVisits.length > 0 ? (
              <ul className="space-y-2">
                {patient.recentVisits.map((visit) => (
                  <li key={visit.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">
                      {formatDateTime(visit.startedAt ?? visit.createdAt)} · {visit.status}
                    </p>
                    {visit.reason ? <p className="text-muted-foreground">{visit.reason}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No visits recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding treatments</CardTitle>
          </CardHeader>
          <CardContent>
            {patient.outstandingTreatments.length > 0 ? (
              <ul className="space-y-2">
                {patient.outstandingTreatments.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border p-3 text-sm"
                  >
                    <span>
                      {item.title ?? 'Treatment plan item'}
                      {item.tooth ? ` · tooth ${item.tooth}` : ''}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                    </span>
                    <span className="text-muted-foreground">
                      {formatMinorUnits(item.estimatedPriceMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BackToList() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/patients">
        <ArrowLeft aria-hidden className="mr-2 h-4 w-4" />
        All patients
      </Link>
    </Button>
  );
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}
