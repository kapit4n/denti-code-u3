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
 * The section nav is data-driven and currently holds one row on purpose: a section
 * is added when — and only when — an endpoint stands behind it, so the nav grows
 * with the milestone (notes, treatment, payments) instead of promising panels that
 * render an empty state. Section choice is component state, not a search param, for
 * the same reason list state on the patients route is: file-route search params are
 * typed `any` today (technical question T2), and a state the URL could not describe
 * honestly is worse than one held here.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import type { Visit } from '@denti-code-u3/domain';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@denti-code-u3/ui';

import { formatClinicDayTime, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { usePatient } from '../../patients/hooks/use-patients.js';
import { useChairs, useDentists } from '../../agenda/queries/bookable-resources-query.js';
import { describeVisitFailure } from '../describe-visit-failure.js';
import { useVisitClosure } from '../mutations/use-visit-closure.js';
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
 * One row today. `notes`, `odontogram`, `treatment`, `files` and `payments` from the
 * brief each arrive with their own endpoint and their own row here — a nav entry
 * with nothing behind it is the "control that looks live and is not" this project
 * refuses to ship.
 */
type VisitSectionId = 'summary';

const VISIT_SECTIONS: readonly { readonly id: VisitSectionId; readonly label: string }[] = [
  { id: 'summary', label: 'Summary' },
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
            The only section that exists. When a second one lands it arrives with the
            endpoint behind it and this becomes a real switch — a `null` here is the
            honest answer for a section nobody can open yet.
          */}
          {section === 'summary' ? (
            <VisitSummarySection
              visit={visit}
              clinicTimeZone={clinic?.timeZone}
              clinicianName={resolveClinician(visit, dentistsQuery)}
              chairLabel={resolveChair(visit, chairsQuery)}
            />
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
