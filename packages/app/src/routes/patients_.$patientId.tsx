/**
 * The patient profile: the central clinical context (Milestone 4).
 *
 * The file is named `patients_.$patientId` rather than living in a
 * `patients/$patientId` folder: the underscore opts this route out of nesting, so
 * the list and the profile are sibling pages. Nested, the list would have to
 * render an `<Outlet />` and the profile would appear inside it.
 *
 * One request returns the record plus everything a clinician needs on open —
 * allergies, the appointments still ahead, the ones that have gone quiet, the open
 * visits, outstanding treatments and the balance. The complete timeline is a
 * separate page: the profile is a working screen, not the history.
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
import { formatMinorUnits, type PatientAppointmentSummary } from '@denti-code-u3/domain';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@denti-code-u3/ui';
import { ArrowLeft, CalendarPlus, ChevronRight } from 'lucide-react';

import { AppointmentBookingDialog } from '../features/agenda/components/appointment-booking-dialog.js';
import { formatClinicDay, formatClinicDayTime } from '../features/clinic/format-clinic-time.js';
import { useClinicSettings } from '../features/clinic/queries/clinic-settings-query.js';
import { RecordPaymentDialog } from '../features/payments/components/record-payment-dialog.js';
import { usePatient } from '../features/patients/hooks/use-patients.js';
import { PatientAllergiesCard } from '../features/patients/components/patient-allergies-card.js';
import { PatientTreatmentPlansSection } from '../features/patients/components/patient-treatment-plans-section.js';
import { PatientInvoicesSection } from '../features/patients/components/patient-invoices-section.js';
import { PatientStatementSection } from '../features/patients/components/patient-statement-section.js';
import { PatientBalanceSection } from '../features/patients/components/patient-balance-section.js';
import { PatientOdontogramSection } from '../features/patients/components/patient-odontogram-section.js';
import { enumLabel, useTranslation } from '../i18n/index.js';

export const Route = createFileRoute('/patients_/$patientId')({
  component: PatientProfile,
});

function PatientProfile() {
  const { patientId } = Route.useParams();
  const { t } = useTranslation();
  const { data: patient, isPending, error } = usePatient(patientId);
  // The clinic, for the booking dialog and for every time drawn on this page.
  const { data: clinic } = useClinicSettings();
  const [isBooking, setIsBooking] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">{t('patients.profile.loading')}</p>;
  }

  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-destructive">
          {error instanceof Error && 'status' in error && error.status === 404
            ? t('patients.profile.notFound')
            : t('patients.profile.loadError')}
        </p>
        <BackToList />
      </div>
    );
  }

  if (!patient) {
    return <p className="text-sm text-muted-foreground">{t('patients.profile.none')}</p>;
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
          {patient.isActive ? t('patients.profile.active') : t('patients.profile.inactive')}
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
            {t('patients.profile.book')}
          </Button>
          {/*
            A link, not a button that swaps in a form. Editing is a separate page
            with its own URL, so a refresh keeps the form open and the back button
            from the profile returns here rather than reloading the list.
          */}
          <Button asChild variant="outline" size="sm">
            <Link to="/patients/$patientId/edit" params={{ patientId }} data-testid="edit-patient">
              {t('patients.profile.edit')}
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('patients.profile.contact')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {t('patients.profile.phone', { value: patient.phone ?? t('common.notProvided') })}
            </p>
            <p>
              {t('patients.profile.email', { value: patient.email ?? t('common.notProvided') })}
            </p>
            <p>
              {t('patients.profile.born', { value: patient.birthDate ?? t('common.notProvided') })}
            </p>
            {/* A day with no time on it, still the clinic's day. '—' while the clinic
                loads, like the phone and email above it: the same "not known yet"
                rather than a date the browser's zone invented. */}
            <p>
              {t('patients.profile.created', {
                value: timeZone
                  ? formatClinicDay(patient.createdAt, timeZone)
                  : t('common.notProvided'),
              })}
            </p>
          </CardContent>
        </Card>

        <PatientAllergiesCard patient={patient} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('patients.profile.appointments')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {patient.overdueAppointments.length > 0 ? (
            <section className="space-y-2">
              <h3 className="font-medium text-destructive">
                {t('patients.profile.overdueAppointments')}
              </h3>
              <ul className="space-y-2">
                {patient.overdueAppointments.map((appointment) => (
                  <ProfileAppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    timeZone={timeZone}
                    overdue
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {patient.upcomingAppointments.length > 0 ? (
            <section className="space-y-2">
              <h3 className="font-medium">{t('patients.profile.upcomingAppointments')}</h3>
              <ul className="space-y-2">
                {patient.upcomingAppointments.map((appointment) => (
                  <ProfileAppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {patient.overdueAppointments.length === 0 && patient.upcomingAppointments.length === 0 ? (
            <p className="text-muted-foreground">{t('patients.profile.nothingBooked')}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{t('patients.profile.openVisits')}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/patients/$patientId/visits"
                params={{ patientId: patient.id }}
                data-testid="all-patient-visits"
              >
                {t('patients.profile.allVisits')}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {patient.openVisits.length > 0 ? (
              <ul className="space-y-2">
                {patient.openVisits.map((visit) => (
                  <li key={visit.id}>
                    {/*
                      A link, because an open visit is the door into its own
                      workspace: a row that cannot be opened leaves the clinical
                      record one click short of its home.
                    */}
                    <Link
                      to="/visits/$visitId"
                      params={{ visitId: visit.id }}
                      className="block rounded-lg border p-3 text-sm transition-colors hover:bg-accent"
                    >
                      <p className="font-medium">
                        {timeZone ? (
                          formatClinicDayTime(visit.startedAt ?? visit.createdAt, timeZone)
                        ) : (
                          <span className="text-muted-foreground">
                            {t('patients.profile.readingClock')}
                          </span>
                        )}{' '}
                        · {enumLabel(t, 'common.status', visit.status)}
                      </p>
                      {visit.reason ? (
                        <p className="text-muted-foreground">{visit.reason}</p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('patients.profile.noOpenVisits')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('patients.profile.outstandingTreatments')}</CardTitle>
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
                      {item.title ?? t('patients.profile.planItemFallback')}
                      {item.tooth ? t('patients.profile.tooth', { tooth: item.tooth }) : ''}
                      {item.quantity > 1
                        ? t('patients.profile.quantity', { count: item.quantity })
                        : ''}
                    </span>
                    <span className="text-muted-foreground">
                      {formatMinorUnits(item.estimatedPriceMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('patients.profile.nothingOutstanding')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        What the clinic has proposed for this patient: read only, and deliberately
        after the profile cards rather than inside one of them — a plan is a series
        of decisions, not a fact about the person.
      */}
      <PatientTreatmentPlansSection patientId={patient.id} clinicTimeZone={timeZone} />

      {/*
        The documents the clinic has issued, and what they come to: siblings of the
        plans and of each other, because a financial document has its own address.
        The balance is not printed inside the list — it is added up by the domain
        across every document and every payment, so a figure computed here would be
        a second answer to the same question, and a payment that has not reached a
        document yet would have nowhere to appear.
      */}
      <PatientBalanceSection
        patientId={patient.id}
        onRecordPayment={() => setIsRecordingPayment(true)}
      />
      <PatientInvoicesSection patientId={patient.id} clinicTimeZone={timeZone} />
      {/*
        The history behind the two cards above, opened on demand: the same documents
        and money in order, with the balance after each line. It is deliberately not
        mounted as an always-on request — a statement is read when it is asked for.
      */}
      <PatientStatementSection patientId={patient.id} clinicTimeZone={timeZone} />

      {/*
        The clinical map: its own request and its own write, mounted as a sibling of
        the profile cards rather than one of them, because charting is clinical work
        with a form and a refusal of its own.
      */}
      <PatientOdontogramSection patientId={patient.id} clinicTimeZone={timeZone} />

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

      {/*
        The payment dialog with this patient fixed. It lists the patient's open
        invoices and the treatments on the chosen one; the profile remains the only
        place that knows who is on screen, so the dialog cannot record money against
        a second patient picked by mistake.
      */}
      {isRecordingPayment ? (
        <RecordPaymentDialog
          fixedPatient={{
            id: patient.id,
            label: `${patient.firstName} ${patient.lastName}`,
          }}
          onClose={() => setIsRecordingPayment(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * One appointment on the profile, overdue or upcoming. Overdue rows get the
 * destructive outline rather than a second badge: the section heading already
 * says what they are, and the row is the thing a receptionist has to act on.
 */
function ProfileAppointmentRow({
  appointment,
  timeZone,
  overdue = false,
}: {
  readonly appointment: PatientAppointmentSummary;
  readonly timeZone?: string;
  readonly overdue?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <li>
      {/*
        The whole row is the action: it opens the agenda on the appointment's own
        day and, once that day's answer arrives, the quick panel for this booking.
        A row that only displayed the time left the receptionist to find the same
        appointment again by hand.
      */}
      <Link
        to="/agenda"
        search={{ appointmentId: appointment.id, date: appointment.startsAt }}
        data-testid={`profile-appointment-${appointment.id}`}
        className={`flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent ${
          overdue ? 'border-destructive/40' : ''
        }`}
      >
        <span className="min-w-0">
          <span className="block font-medium">
            {/* Says it is waiting rather than showing the wrong hour: a fallback to
                the visitor's zone would put "Nothing booked" and "Tonight" in the same
                slot, and one of them is a lie. */}
            {timeZone ? (
              formatClinicDayTime(appointment.startsAt, timeZone)
            ) : (
              <span className="text-muted-foreground">{t('patients.profile.readingClock')}</span>
            )}{' '}
            · {t('patients.profile.duration', { count: appointment.durationMinutes })} ·{' '}
            {enumLabel(t, 'common.status', appointment.status)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {t('patients.profile.openInAgenda')}
          <ChevronRight aria-hidden className="size-4" />
        </span>
      </Link>
    </li>
  );
}

function BackToList() {
  const { t } = useTranslation();

  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/patients">
        <ArrowLeft aria-hidden className="mr-2 h-4 w-4" />
        {t('patients.profile.backToAll')}
      </Link>
    </Button>
  );
}
