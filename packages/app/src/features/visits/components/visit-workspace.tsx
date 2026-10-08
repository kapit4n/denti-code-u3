/**
 * The visit workspace: one visit, the patient it belongs to, and what may be done
 * to it (Milestone 6).
 *
 * The shape is the one the brief asks for — a patient/visit header, a left section
 * nav, and a right workspace — and it exists because the two closure endpoints had
 * no home: `complete` and `reopen` were reachable only by a client that already
 * knew the id, which is no client at all. This is where the action happens, which
 * is what the milestone's exit criterion was waiting for.
 *
 * **Three things this screen refuses to guess.**
 *
 *  - *Times are the clinic's.* Every instant is drawn with `formatClinicDayTime`
 *    against `clinic.timeZone`, and while the clinic is still being fetched the
 *    slot says so rather than falling back to the browser's zone — same rule as the
 *    patient profile and the quick panel, for the same reason.
 *  - *Names are looked up, never invented.* The visit carries ids only, so the
 *    clinician and the chair are resolved against the bookable lists, which are
 *    asked for `onlyActive: false`: a clinician who has left still names the visit
 *    they treated, and hiding the row would leave the header saying "—", which is a
 *    different fact from "this visit has no clinician".
 *  - *Buttons come from the domain, and only from moves with an endpoint.* See
 *    `visitClosureTransitions` — the legal table allows a cancellation no endpoint
 *    performs, so offering it would be a control that 404s.
 *
 * **Nothing is written optimistically.** The mutation invalidates the visit and the
 * patient's profile; the refetch is what changes the status chip. A panel that
 * showed "Completed" before the server agreed would be the only screen in the app
 * that could contradict the record.
 *
 * The section nav is data-driven and holds the sections an endpoint stands behind:
 * `summary` reads the visit, `notes` reads and writes the notes on it, `treatments`
 * reads and writes what was performed, `prescriptions` reads and writes what the
 * patient was sent home with. A row is added when — and only
 * when — an endpoint stands behind it, so the nav grows with the milestone
 * (odontogram, files, payments) instead of promising panels that render an empty
 * state. Section choice is component state, not a search param, for
 * the same reason list state on the patients route is: file-route search params are
 * typed `any` today (technical question T2), and a state the URL could not describe
 * honestly is worse than one held here.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import type { Charge, MedicationRoute, TreatmentRecord, Visit } from '@denti-code-u3/domain';
import { formatMinorUnits } from '@denti-code-u3/domain';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@denti-code-u3/ui';

import { formatClinicDayTime, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { usePatient } from '../../patients/hooks/use-patients.js';
import { useChairs, useDentists } from '../../agenda/queries/bookable-resources-query.js';
import { chargeLineTotal, chargesTotal, parseMajorUnitsToMinor } from '../charge-presentation.js';
import { describeChargeFailure } from '../describe-charge-failure.js';
import { describeNoteFailure } from '../describe-note-failure.js';
import { describePrescriptionFailure } from '../describe-prescription-failure.js';
import { describeTreatmentFailure } from '../describe-treatment-failure.js';
import { describeVisitFailure } from '../describe-visit-failure.js';
import { useCreateCharge } from '../mutations/use-create-charge.js';
import { useCreateClinicalNote } from '../mutations/use-create-clinical-note.js';
import { useCreatePrescription } from '../mutations/use-create-prescription.js';
import { useRecordVisitTreatment } from '../mutations/use-record-visit-treatment.js';
import { useVisitClosure } from '../mutations/use-visit-closure.js';
import { MEDICATION_ROUTE_OPTIONS, medicationRouteLabel } from '../prescription-presentation.js';
import { useVisitCharges } from '../queries/charges-query.js';
import { useVisitPrescriptions } from '../queries/prescriptions-query.js';
import { useTreatments, useVisitTreatments } from '../queries/treatments-query.js';
import { useVisitNotes } from '../queries/visit-notes-query.js';
import { useVisit } from '../queries/visit-query.js';
import {
  visitClosureLabel,
  visitClosureTransitions,
  visitStatusClassName,
  visitStatusLabel,
} from '../visit-status-presentation.js';

export interface VisitWorkspaceProps {
  readonly visitId: string;
}

/**
 * The sections this workspace can draw.
 *
 * Five rows today, each with an endpoint behind it. `odontogram`, `files` and
 * `payments` from the brief each arrive with their own endpoint and their own row
 * here — a nav entry with nothing behind it is the "control that looks live and is
 * not" this project refuses to ship.
 */
type VisitSectionId = 'summary' | 'notes' | 'treatments' | 'prescriptions' | 'charges';

const VISIT_SECTIONS: readonly { readonly id: VisitSectionId; readonly label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'notes', label: 'Notes' },
  { id: 'treatments', label: 'Treatments' },
  { id: 'prescriptions', label: 'Prescriptions' },
  { id: 'charges', label: 'Charges' },
];

export function VisitWorkspace({ visitId }: VisitWorkspaceProps) {
  const visitQuery = useVisit(visitId);
  const { data: clinic } = useClinicSettings();
  // The profile arrives after the visit (its key needs the patient id), so this
  // query is held back by `enabled` inside the hook rather than by a conditional
  // hook call, which React forbids.
  const patientQuery = usePatient(visitQuery.data?.patientId ?? '');
  const dentistsQuery = useDentists({ onlyActive: false });
  const chairsQuery = useChairs({ onlyActive: false });
  const closure = useVisitClosure();
  const [section, setSection] = useState<VisitSectionId>('summary');

  if (visitQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading the visit…</p>;
  }

  if (visitQuery.error) {
    const error = visitQuery.error;
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-destructive">
          {/* The status, not the envelope's message: another clinic's id and an id
              that never existed answer alike (ADR 0014), so the screen must not
              claim to know which one it got. */}
          {error instanceof Error && 'status' in error && error.status === 404
            ? 'This visit does not exist in the current clinic.'
            : 'The visit could not be loaded.'}
        </p>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/patients">
            <ArrowLeft aria-hidden className="mr-2 h-4 w-4" />
            All patients
          </Link>
        </Button>
      </div>
    );
  }

  if (!visitQuery.data) {
    return <p className="text-sm text-muted-foreground">The visit could not be loaded.</p>;
  }

  const visit = visitQuery.data;
  const patient = patientQuery.data;
  const patientName = patient
    ? (patient.preferredName ?? `${patient.firstName} ${patient.lastName}`)
    : undefined;

  const failure = describeVisitFailure(closure.error, 'The visit could not be updated.');
  const closable = visitClosureTransitions(visit.status);

  return (
    <div className="flex flex-col gap-6" data-testid="visit-workspace">
      <header className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            to="/patients/$patientId"
            params={{ patientId: visit.patientId }}
            data-testid="back-to-patient"
          >
            <ArrowLeft aria-hidden className="mr-2 h-4 w-4" />
            {patientName ? `${patientName}’s record` : 'Patient record'}
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">
              {patientName ??
                (patientQuery.isPending ? 'Loading patient…' : 'Patient record unavailable')}
            </h1>
            <p className="text-muted-foreground">
              {patient?.recordNumber ? `${patient.recordNumber} · ` : ''}
              {/* Said here rather than left to be inferred from the chip below: a
                  walk-in and a booking are both visits, and only one of them has an
                  appointment behind it. */}
              {visit.appointmentId ? 'Started from a booking' : 'Walk-in'}
            </p>
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 text-xs font-medium',
                visitStatusClassName(visit.status),
              )}
              data-testid="visit-status"
            >
              {visitStatusLabel(visit.status)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {closable.length === 0 ? (
              // Said out loud rather than shown as an empty row of buttons: a
              // cancelled visit is history, and silence here reads as a panel that
              // failed to load.
              <p className="text-sm text-muted-foreground">
                This visit cannot be reopened. Its record is kept as it is.
              </p>
            ) : (
              closable.map((to) => (
                <Button
                  key={to}
                  type="button"
                  disabled={closure.isPending}
                  data-testid={to === 'COMPLETED' ? 'complete-visit' : 'reopen-visit'}
                  onClick={() => closure.mutate({ visitId: visit.id, to })}
                >
                  {visitClosureLabel(to)}
                </Button>
              ))
            )}
            {closure.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </div>
        </div>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Visit sections" className="self-start">
          <ul className="flex gap-2 lg:flex-col">
            {VISIT_SECTIONS.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setSection(entry.id)}
                  aria-current={section === entry.id ? 'page' : undefined}
                  data-testid={`visit-section-${entry.id}`}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                    section === entry.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                  )}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          {/*
            The sections that exist, and only those: each has an endpoint behind it
            and a row in the nav above. A `null` here would be the honest answer for a
            section nobody can open yet — but the nav cannot offer one, so nothing
            reaches this switch without a panel to draw.
          */}
          {section === 'summary' ? (
            <VisitSummarySection
              visit={visit}
              clinicTimeZone={clinic?.timeZone}
              clinicianName={resolveClinician(visit, dentistsQuery)}
              chairLabel={resolveChair(visit, chairsQuery)}
            />
          ) : null}
          {section === 'notes' ? (
            <VisitNotesSection visitId={visit.id} clinicTimeZone={clinic?.timeZone} />
          ) : null}
          {section === 'treatments' ? (
            <VisitTreatmentsSection visitId={visit.id} clinicTimeZone={clinic?.timeZone} />
          ) : null}
          {section === 'prescriptions' ? (
            <VisitPrescriptionsSection visitId={visit.id} clinicTimeZone={clinic?.timeZone} />
          ) : null}
          {section === 'charges' ? (
            <VisitChargesSection visitId={visit.id} clinicTimeZone={clinic?.timeZone} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface VisitSummarySectionProps {
  readonly visit: Visit;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
  readonly clinicianName: string;
  readonly chairLabel: string;
}

function VisitSummarySection({
  visit,
  clinicTimeZone,
  clinicianName,
  chairLabel,
}: VisitSummarySectionProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Visit</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Started</dt>
            <dd>
              {visit.startedAt && clinicTimeZone ? (
                formatClinicDayTime(visit.startedAt, clinicTimeZone)
              ) : (
                <span className="text-muted-foreground">
                  {visit.startedAt ? READING_THE_CLINIC_CLOCK : '—'}
                </span>
              )}
            </dd>

            <dt className="text-muted-foreground">Ended</dt>
            <dd>
              {visit.endedAt && clinicTimeZone ? (
                formatClinicDayTime(visit.endedAt, clinicTimeZone)
              ) : visit.endedAt ? (
                <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
              ) : visit.status === 'OPEN' ? (
                <span className="text-muted-foreground">Not finished yet</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>

            <dt className="text-muted-foreground">Clinician</dt>
            <dd>{clinicianName}</dd>

            <dt className="text-muted-foreground">Chair</dt>
            <dd>{chairLabel}</dd>
          </dl>
        </CardContent>
      </Card>

      {/*
        Its own card, never folded into the facts above: the summary is what the
        clinician wrote, and "nothing recorded" next to a set of times is a fact
        about the note, not a missing value.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Clinical summary</CardTitle>
          <CardDescription>What was recorded for this visit</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {visit.summary ? (
            <p>{visit.summary}</p>
          ) : (
            <p className="text-muted-foreground">No clinical summary recorded.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * The clinician's notes on this visit: what was written, and the door to write more.
 *
 * Mounted only while the section is open, which is what keeps the notes request an
 * answer to something on screen (see `visit-notes-query.ts`). It owns its own hooks
 * rather than taking them as props for the reason the summary takes data as props: the
 * summary is facts the workspace already holds, and this is a feature with a draft, a
 * mutation and a list of its own.
 *
 * **Nothing is written optimistically, and the empty box stays until the server
 * answers.** The note appears in the list because the invalidation refetched it — a
 * note shown before the API accepted it is a clinical record the record does not
 * contain. The draft is cleared on success, and only there: a refused note is still
 * the clinician's text, and taking it back after a network error would be the one
 * destructive thing this screen does.
 */
interface VisitNotesSectionProps {
  readonly visitId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

function VisitNotesSection({ visitId, clinicTimeZone }: VisitNotesSectionProps) {
  const notesQuery = useVisitNotes(visitId);
  const createNote = useCreateClinicalNote();
  const [draft, setDraft] = useState('');

  const failure = describeNoteFailure(createNote.error, 'The note could not be saved.');
  const ready = draft.trim().length > 0;

  return (
    <Card data-testid="visit-notes">
      <CardHeader>
        <CardTitle>Clinical notes</CardTitle>
        <CardDescription>What was written during this visit</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the notes…</p>
        ) : notesQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            The notes could not be loaded.
          </p>
        ) : notesQuery.data.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {notesQuery.data.notes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border p-3 text-sm"
                data-testid="clinical-note"
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {clinicTimeZone ? (
                    formatClinicDayTime(note.createdAt, clinicTimeZone)
                  ) : (
                    <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
                  )}
                </p>
                {/* Whitespace is preserved because the textarea offers it: a note that
                    swallowed its line breaks would read as one sentence the clinician
                    did not write. React escapes the text itself. */}
                <p className="whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) {
              return;
            }
            createNote.mutate(
              { visitId, body: draft },
              {
                onSuccess: () => setDraft(''),
              },
            );
          }}
        >
          <Label htmlFor="visit-note-body">New note</Label>
          <textarea
            id="visit-note-body"
            data-testid="note-body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            disabled={createNote.isPending}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="What was seen, said or done"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" data-testid="add-note" disabled={createNote.isPending || !ready}>
              Add note
            </Button>
            {createNote.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </div>
        </form>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * What was actually done in this visit, and the door to record more.
 *
 * Mounted only while the section is open, which is what keeps both requests — the
 * catalogue and this visit's records — answers to something on screen (see
 * `treatments-query.ts`). It owns its own hooks rather than taking them as props
 * for the same reason the notes section does: this is a feature with a picker, a
 * draft and a mutation of its own.
 *
 * The catalogue is fetched here, not at the workspace: the picker is the only
 * place on this screen that needs it, and a clinic list hanging in a page that
 * does not draw it is a request waiting to be stale.
 *
 * **Nothing is written optimistically, and the form stays filled until the server
 * answers.** The recorded treatment appears in the list because the invalidation
 * refetched it — a treatment shown before the API accepted it is a clinical record
 * the record does not contain. The form clears on success, and only there: a
 * refused record is still the clinician's selection, and taking it back after a
 * network error would be the one destructive thing this panel does.
 *
 * The list shows the *name* a record's treatment gained here, resolved against
 * the catalogue rather than trusted to arrive on the record: the ending is
 * presentation, and a name stored with the record would be a second source that
 * could drift. A treatment retired from the catalogue still names the records it
 * performed — the offer and the fact are different things, and the offer does not
 * get to rewrite what was done.
 */
interface VisitTreatmentsSectionProps {
  readonly visitId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

function VisitTreatmentsSection({ visitId, clinicTimeZone }: VisitTreatmentsSectionProps) {
  const catalogueQuery = useTreatments();
  const recordsQuery = useVisitTreatments(visitId);
  const record = useRecordVisitTreatment();
  const [treatmentId, setTreatmentId] = useState('');
  const [tooth, setTooth] = useState('');
  const [draft, setDraft] = useState('');

  const failure = describeTreatmentFailure(record.error, 'The treatment could not be recorded.');
  const ready = treatmentId.length > 0;
  const catalogue = catalogueQuery.data?.items ?? [];

  return (
    <Card data-testid="visit-treatments">
      <CardHeader>
        <CardTitle>Treatments</CardTitle>
        <CardDescription>What was performed during this visit</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {recordsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the treatments…</p>
        ) : recordsQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            The treatments could not be loaded.
          </p>
        ) : (recordsQuery.data?.treatments.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No treatments recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {recordsQuery.data?.treatments.map((performed) => (
              <li
                key={performed.id}
                className="rounded-md border p-3 text-sm"
                data-testid="treatment-record"
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {clinicTimeZone ? (
                    formatClinicDayTime(performed.performedAt, clinicTimeZone)
                  ) : (
                    <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
                  )}
                </p>
                <p className="font-medium">{resolveTreatmentName(performed, catalogueQuery)}</p>
                {performed.tooth ? <p>Tooth {performed.tooth}</p> : null}
                {/* Whitespace is preserved because the textarea offers it, the same
                    rule as a note. */}
                {performed.notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {performed.notes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) {
              return;
            }
            record.mutate(
              { visitId, treatmentId, tooth, notes: draft },
              {
                onSuccess: () => {
                  setTreatmentId('');
                  setTooth('');
                  setDraft('');
                },
              },
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="treatment-catalogue">Treatment</Label>
            <Select value={treatmentId} onValueChange={setTreatmentId} disabled={record.isPending}>
              <SelectTrigger id="treatment-catalogue" data-testid="treatment-catalogue">
                <SelectValue placeholder="Choose a treatment" />
              </SelectTrigger>
              <SelectContent>
                {catalogue.map((treatment) => (
                  <SelectItem key={treatment.id} value={treatment.id}>
                    {treatment.code ? `${treatment.code} · ${treatment.name}` : treatment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {catalogueQuery.isPending ? (
              <p className="text-xs text-muted-foreground" role="status">
                Loading the catalogue…
              </p>
            ) : null}
            {!catalogueQuery.isPending && catalogue.length === 0 ? (
              // Said out loud rather than showing an empty dropdown: a clinic with
              // no catalogue cannot record anything, and a silent select looks like
              // a form that has not loaded.
              <p className="text-xs text-muted-foreground">
                This clinic has no treatments in its catalogue yet, so nothing can be recorded.
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="treatment-tooth">Tooth (optional)</Label>
            <input
              id="treatment-tooth"
              data-testid="treatment-tooth"
              value={tooth}
              onChange={(event) => setTooth(event.target.value)}
              maxLength={2}
              disabled={record.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="FDI number, e.g. 16"
              inputMode="numeric"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="treatment-notes">Notes (optional)</Label>
            <textarea
              id="treatment-notes"
              data-testid="treatment-notes"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              disabled={record.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="What was done"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              data-testid="record-treatment"
              disabled={record.isPending || !ready}
            >
              Record treatment
            </Button>
            {record.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </div>
        </form>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The prescriptions written on this visit, and the door to write more.
 *
 * Mounted only while the section is open, which is what keeps the prescriptions
 * request an answer to something on screen (see `prescriptions-query.ts`). It owns
 * its own hooks rather than taking them as props for the same reason the notes
 * section does: this is a feature with a picker, a draft and a mutation of its own.
 *
 * **Nothing is written optimistically, and the form stays filled until the server
 * answers.** The prescription appears in the list because the invalidation refetched
 * it — a course shown before the API accepted it is a clinical record the record does
 * not contain. The form clears on success, and only there: a refused prescription is
 * still the clinician's draft, and taking it back after a network error would be the
 * one destructive thing this panel does.
 *
 * The route's label comes from `prescription-presentation.ts`, the same place the
 * picker reads it from: one spelling of each route on this screen, never two.
 */
interface VisitPrescriptionsSectionProps {
  readonly visitId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

function VisitPrescriptionsSection({ visitId, clinicTimeZone }: VisitPrescriptionsSectionProps) {
  const prescriptionsQuery = useVisitPrescriptions(visitId);
  const createPrescription = useCreatePrescription();
  const [medication, setMedication] = useState('');
  const [dosage, setDosage] = useState('');
  const [route, setRoute] = useState<MedicationRoute | ''>('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [instructions, setInstructions] = useState('');

  const failure = describePrescriptionFailure(
    createPrescription.error,
    'The prescription could not be written.',
  );

  const wholeDays = Number(durationDays);
  const ready =
    medication.trim().length > 0 &&
    dosage.trim().length > 0 &&
    route.length > 0 &&
    frequency.trim().length > 0 &&
    Number.isInteger(wholeDays) &&
    wholeDays > 0;

  return (
    <Card data-testid="visit-prescriptions">
      <CardHeader>
        <CardTitle>Prescriptions</CardTitle>
        <CardDescription>What the patient was sent home with</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {prescriptionsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the prescriptions…</p>
        ) : prescriptionsQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            The prescriptions could not be loaded.
          </p>
        ) : prescriptionsQuery.data.prescriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prescriptions written yet.</p>
        ) : (
          <ul className="space-y-3">
            {prescriptionsQuery.data.prescriptions.map((prescription) => (
              <li
                key={prescription.id}
                className="rounded-md border p-3 text-sm"
                data-testid="prescription"
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {clinicTimeZone ? (
                    formatClinicDayTime(prescription.issuedAt, clinicTimeZone)
                  ) : (
                    <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
                  )}
                </p>
                <p className="font-medium">
                  {prescription.medication} · {prescription.dosage}
                </p>
                <p className="text-muted-foreground">
                  {medicationRouteLabel(prescription.route)} · {prescription.frequency}
                  {prescription.durationDays === 1
                    ? ' · 1 day'
                    : ` · ${prescription.durationDays} days`}
                </p>
                {prescription.instructions ? (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {prescription.instructions}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) {
              return;
            }
            createPrescription.mutate(
              {
                visitId,
                medication,
                dosage,
                route: route as MedicationRoute,
                frequency,
                durationDays: wholeDays,
                instructions,
              },
              {
                onSuccess: () => {
                  setMedication('');
                  setDosage('');
                  setRoute('');
                  setFrequency('');
                  setDurationDays('');
                  setInstructions('');
                },
              },
            );
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prescription-medication">Medication</Label>
              <input
                id="prescription-medication"
                data-testid="prescription-medication"
                value={medication}
                onChange={(event) => setMedication(event.target.value)}
                disabled={createPrescription.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="e.g. Ibuprofen"
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="prescription-dosage">Dosage</Label>
              <input
                id="prescription-dosage"
                data-testid="prescription-dosage"
                value={dosage}
                onChange={(event) => setDosage(event.target.value)}
                disabled={createPrescription.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="e.g. 400 mg"
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prescription-route">Route</Label>
              <Select
                value={route}
                onValueChange={(value) => setRoute(value as MedicationRoute)}
                disabled={createPrescription.isPending}
              >
                <SelectTrigger id="prescription-route" data-testid="prescription-route">
                  <SelectValue placeholder="Choose a route" />
                </SelectTrigger>
                <SelectContent>
                  {MEDICATION_ROUTE_OPTIONS.map((option) => (
                    <SelectItem key={option.route} value={option.route}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="prescription-frequency">Frequency</Label>
              <input
                id="prescription-frequency"
                data-testid="prescription-frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                disabled={createPrescription.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="e.g. Every 8 hours"
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="prescription-duration">Length of course</Label>
              <input
                id="prescription-duration"
                data-testid="prescription-duration"
                value={durationDays}
                onChange={(event) => setDurationDays(event.target.value)}
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                disabled={createPrescription.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="Days"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="prescription-instructions">Instructions (optional)</Label>
            <textarea
              id="prescription-instructions"
              data-testid="prescription-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={2}
              disabled={createPrescription.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="e.g. Take after meals"
              maxLength={2000}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              data-testid="write-prescription"
              disabled={createPrescription.isPending || !ready}
            >
              Write prescription
            </Button>
            {createPrescription.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </div>
        </form>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The charges raised on this visit, and the door to raise more.
 *
 * Mounted only while the section is open, which is what keeps the charges request
 * an answer to something on screen (see `charges-query.ts`). It owns its own hooks
 * rather than taking them as props for the same reason the prescriptions section
 * does: this is a feature with a draft, a mutation and a list of its own.
 *
 * **Nothing is written optimistically, and the form stays filled until the server
 * answers.** The charge appears in the list because the invalidation refetched it —
 * a price shown before the API accepted it is a claim on the patient's balance the
 * record does not contain. The form clears on success, and only there: a refused
 * charge is still the front desk's draft, and taking it back after a network error
 * would be the one destructive thing this panel does.
 *
 * **Major units are the door, minor units are the wire.** The boxes take "120.00"
 * and `parseMajorUnitsToMinor` hands the mutation an integer of cents, the shape
 * the API and the domain always use. The list shows the line total computed by the
 * domain's own `calculateChargeTotal` — quantity × unit price, minus the discount,
 * priced in the clinic's currency — never a total this screen re-derived and could
 * disagree with the record about.
 */
interface VisitChargesSectionProps {
  readonly visitId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

function VisitChargesSection({ visitId, clinicTimeZone }: VisitChargesSectionProps) {
  const chargesQuery = useVisitCharges(visitId);
  const createCharge = useCreateCharge();
  const [description, setDescription] = useState('');
  const [priceMajor, setPriceMajor] = useState('');
  const [quantity, setQuantity] = useState('');
  const [discountMajor, setDiscountMajor] = useState('');

  const failure = describeChargeFailure(createCharge.error, 'The charge could not be raised.');

  const parsedPrice = parseMajorUnitsToMinor(priceMajor);
  const parsedDiscount = parseMajorUnitsToMinor(discountMajor);
  const parsedQuantity = quantity.trim() === '' ? undefined : Number(quantity);
  const ready =
    description.trim().length > 0 &&
    parsedPrice !== undefined &&
    (parsedQuantity === undefined || (Number.isInteger(parsedQuantity) && parsedQuantity > 0));

  const list = chargesQuery.data?.charges ?? [];
  const totalMinor = list.length > 0 ? chargesTotal(list, list[0]!.currency) : undefined;

  return (
    <Card data-testid="visit-charges">
      <CardHeader>
        <CardTitle>Charges</CardTitle>
        <CardDescription>
          What this visit has been priced at, and what is still to pay
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {chargesQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the charges…</p>
        ) : chargesQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            The charges could not be loaded.
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No charges raised yet.</p>
        ) : (
          <ul className="space-y-3">
            {list.map((charge) => (
              <ChargeRow key={charge.id} charge={charge} clinicTimeZone={clinicTimeZone} />
            ))}
          </ul>
        )}

        {list.length > 0 ? (
          <div
            className="flex items-center justify-between border-t pt-3 text-sm"
            data-testid="charges-total"
          >
            <span className="font-medium">Total so far</span>
            {/* The domain's own sum, in the charges' own currency. */}
            <span className="font-medium">{formatMinorUnits(totalMinor ?? 0)}</span>
          </div>
        ) : null}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || parsedPrice === undefined) {
              return;
            }
            createCharge.mutate(
              {
                visitId,
                description,
                ...(parsedQuantity !== undefined ? { quantity: parsedQuantity } : {}),
                unitPriceMinor: parsedPrice,
                ...(parsedDiscount !== undefined && parsedDiscount > 0
                  ? { discountMinor: parsedDiscount }
                  : {}),
              },
              {
                onSuccess: () => {
                  setDescription('');
                  setPriceMajor('');
                  setQuantity('');
                  setDiscountMajor('');
                },
              },
            );
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="charge-description">Description</Label>
            <input
              id="charge-description"
              data-testid="charge-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={createCharge.isPending}
              className="w-full rounded-md border bg-background p-2 text-sm"
              placeholder="e.g. Composite restoration, tooth 16"
              maxLength={200}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="charge-unit-price">Unit price</Label>
              <input
                id="charge-unit-price"
                data-testid="charge-unit-price"
                value={priceMajor}
                onChange={(event) => setPriceMajor(event.target.value)}
                inputMode="decimal"
                disabled={createCharge.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="120.00"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="charge-quantity">Quantity (optional)</Label>
              <input
                id="charge-quantity"
                data-testid="charge-quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                disabled={createCharge.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="1"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="charge-discount">Discount (optional)</Label>
              <input
                id="charge-discount"
                data-testid="charge-discount"
                value={discountMajor}
                onChange={(event) => setDiscountMajor(event.target.value)}
                inputMode="decimal"
                disabled={createCharge.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              data-testid="raise-charge"
              disabled={createCharge.isPending || !ready}
            >
              Raise charge
            </Button>
            {createCharge.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                Saving…
              </p>
            ) : null}
          </div>
        </form>

        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChargeRow({
  charge,
  clinicTimeZone,
}: {
  readonly charge: Charge;
  readonly clinicTimeZone: string | undefined;
}) {
  const total = chargeLineTotal(charge).amountMinor;

  return (
    <li className="rounded-md border p-3 text-sm" data-testid="charge">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            {clinicTimeZone ? (
              formatClinicDayTime(charge.createdAt, clinicTimeZone)
            ) : (
              <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
            )}
          </p>
          <p className="font-medium">{charge.description}</p>
          <p className="text-muted-foreground">
            {formatMinorUnits(charge.unitPriceMinor)}
            {charge.quantity > 1 ? ` × ${charge.quantity}` : ''}
            {charge.discountMinor > 0 ? (
              <>
                {' · '}
                <span className="line-through">
                  {formatMinorUnits(charge.unitPriceMinor * charge.quantity)}
                </span>{' '}
                less {formatMinorUnits(charge.discountMinor)}
              </>
            ) : null}
          </p>
        </div>
        {/* The domain's own line total (quantity × price − discount + tax), shown
            here and not re-derived by the screen. */}
        <p className="font-medium" data-testid="charge-total">
          {formatMinorUnits(total)}
        </p>
      </div>
    </li>
  );
}

/**
 * The treatment a record performed, through the live catalogue, or a sentence for
 * every way it can be unknown.
 */
function resolveTreatmentName(
  performed: TreatmentRecord,
  query: ReturnType<typeof useTreatments>,
): string {
  const match = query.data?.items.find((item) => item.id === performed.treatmentId);
  if (match) {
    return match.name;
  }
  // Distinguish "still reading the catalogue" from "a treatment the offer no
  // longer holds": the record is what was done, and the offer may move on.
  return query.isPending ? '…' : 'A treatment no longer in the catalogue';
}

/**
 * The clinician's name, or a sentence for every way it can be unknown.
 *
 * Three different facts, deliberately not one fallback: a visit with no clinician
 * recorded, a name still being fetched, and a name the list does not hold. Collapsing
 * them into "—" would make the first and the third look like the second.
 */
function resolveClinician(visit: Visit, query: ReturnType<typeof useDentists>): string {
  if (!visit.dentistId) {
    return 'No clinician recorded';
  }
  const match = query.data?.items.find((dentist) => dentist.id === visit.dentistId);
  if (match) {
    return match.fullName;
  }
  return query.isPending ? '—' : 'Clinician not found';
}

function resolveChair(visit: Visit, query: ReturnType<typeof useChairs>): string {
  if (!visit.chairId) {
    return 'No chair assigned';
  }
  const match = query.data?.items.find((chair) => chair.id === visit.chairId);
  if (match) {
    // The room travels with the chair because "Sillón 1" alone identifies nothing
    // once the clinic has more than one room — the same reason the list endpoint
    // joins it rather than returning the id.
    return match.roomName ? `${match.name} · ${match.roomName}` : match.name;
  }
  return query.isPending ? '—' : 'Chair not found';
}
