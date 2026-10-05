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
 * component. Dates and times are drawn in the **clinic's** zone, which is why this
 * route asks who the clinic is: a next appointment rendered in the visitor's zone is
 * an appointment at the wrong hour, and the number still looks like a time.
 *
 * Booking from here means the dialog the agenda uses, with this patient already
 * chosen. Not a link to the agenda and not a second dialog that drifted: the agenda
 * is the one place that knows how a booking is made, and a page that re-implemented
 * it would be a second opinion about the clinic's rules (see
 * `appointment-booking-dialog.tsx`).
 *
 * **What used to be here, and why it is not coming back:** `toLocaleDateString()` and
 * `toLocaleString()` with no `timeZone`, which answer with the *visitor's* zone. On
 * every receptionist's machine in Peru that is right, which is how it got this far; the
 * day it stops being true is the day this profile lies about when the patient is
 * coming, and nothing on screen would show it. The clinic's zone is data — one API row —
 * and every formatter above takes it.
 */

import { useState } from 'react';
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
import { ArrowLeft, CalendarPlus } from 'lucide-react';

import { AppointmentBookingDialog } from '../features/agenda/components/appointment-booking-dialog.js';
import { formatClinicDay, formatClinicDayTime } from '../features/clinic/format-clinic-time.js';
import { useClinicSettings } from '../features/clinic/queries/clinic-settings-query.js';
import { usePatient } from '../features/patients/hooks/use-patients.js';

export const Route = createFileRoute('/patients_/$patientId')({
  component: PatientProfile,
});

/**
 * What a time reads as while the clinic is still being fetched.
 *
 * **Said once because it is said in three places** — the next appointment, each recent
 * visit, and the moment the record was created — and three copies of a sentence drift.
 * It names what is being waited for rather than showing nothing: a blank where a time
 * belongs reads as "there is no appointment", which is a different fact.
 */
const READING_THE_CLINIC_CLOCK = 'Reading the clinic’s clock…';

function PatientProfile() {
  const { patientId } = Route.useParams();
  const { data: patient, isPending, error } = usePatient(patientId);
  // The clinic, for the booking dialog and for every time drawn on this page.
  const { data: clinic } = useClinicSettings();
  const [isBooking, setIsBooking] = useState(false);

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

  const timeZone = clinic?.timeZone;

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
        {/*
          Two actions, side by side: the one that fills the book and the one that fixes
          the record. Booking is the primary because arriving at a profile usually means
          the patient is here — but it is a button rather than a link because the
          dialog has no URL of its own, and a page that navigates away to be replaced
          by a dialog is a page that loses the person's scroll position for nothing.
        */}
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            onClick={() => setIsBooking(true)}
            // Without the clinic there is no timezone to read the time in and no
            // operating hours to book against, so the dialog would open onto a form
            // that cannot say when it is for. `staleTime: Infinity` means this is a
            // one-off, not a state this button lives in.
            disabled={!clinic}
            data-testid="book-appointment"
          >
            <CalendarPlus aria-hidden className="mr-2 h-4 w-4" />
            Book appointment
          </Button>
          {/*
            A link, not a button that swaps in a form. Editing is a separate page
            with its own URL, so a refresh keeps the form open and the back button
            from the profile returns here rather than reloading the list.
          */}
          <Button asChild variant="outline" size="sm">
            <Link to="/patients/$patientId/edit" params={{ patientId }} data-testid="edit-patient">
              Edit details
            </Link>
          </Button>
        </div>
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
            {/* A day with no time on it, still the clinic's day. '—' while the clinic
                loads, like the phone and email above it: the same "not known yet"
                rather than a date the browser's zone invented. */}
            <p>Record created: {timeZone ? formatClinicDay(patient.createdAt, timeZone) : '—'}</p>
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
              {/* Says it is waiting rather than showing the wrong hour: a fallback to
                  the visitor's zone would put "Nothing booked" and "Tonight" in the
                  same slot, and one of them is a lie. */}
              {timeZone ? (
                formatClinicDayTime(patient.upcomingAppointment.startsAt, timeZone)
              ) : (
                <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
              )}{' '}
              · {patient.upcomingAppointment.durationMinutes} min ·{' '}
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
                      {timeZone ? (
                        formatClinicDayTime(visit.startedAt ?? visit.createdAt, timeZone)
                      ) : (
                        <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
                      )}{' '}
                      · {visit.status}
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

      {/*
        The agenda's dialog, with this patient already chosen and no slot — there is no
        grid behind this page to click, so the time is the person's to state. It closes
        itself when the API agrees and the refetch brings the new appointment back into
        the card above, so nothing here is written optimistically.
      */}
      {isBooking && clinic ? (
        <AppointmentBookingDialog
          clinic={clinic}
          patient={{
            id: patient.id,
            // The same label the picker shows, so the name in the dialog is the name on
            // the page rather than a second way of spelling it.
            label: `${patient.firstName} ${patient.lastName}`,
          }}
          onClose={() => setIsBooking(false)}
        />
      ) : null}
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
