/**
 * The patient's treatment plans: what has been offered, and how far it has got.
 *
 * Mounted on the profile beside the odontogram, which is what keeps its one
 * request an answer to something on screen — the same ownership the odontogram
 * section has (its own hook, its own card, no props beyond the patient).
 *
 * **It is read-only, deliberately.** Milestone 8's write half — presenting a
 * plan, accepting or declining one, marking an item done — has no endpoints yet,
 * and this section is not going to draw a control that would POST to nothing.
 * What it does have is the server's own `progress` projection: the section draws
 * the numbers the API computed from the rows rather than counting the list
 * itself, so the card and the endpoint cannot disagree about how much of a plan
 * is done.
 *
 * A plan's items are named through the treatment the row joins to — `treatmentName`
 * is nullable because the treatment can be deleted under it, and a vanished name
 * renders the code rather than an invented title. The offer and the fact of what
 * was performed are different things; neither rewrites the other.
 */

import { formatMinorUnits } from '@denti-code-u3/domain';
import { ClipboardList } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';
import { formatClinicDay, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { usePatientTreatmentPlans } from '../hooks/use-patients.js';

interface PatientTreatmentPlansSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

export function PatientTreatmentPlansSection({
  patientId,
  clinicTimeZone,
}: PatientTreatmentPlansSectionProps) {
  const plansQuery = usePatientTreatmentPlans(patientId);
  const plans = plansQuery.data?.items ?? [];

  return (
    <Card data-testid="patient-treatment-plans">
      <CardHeader>
        <CardTitle>Treatment plans</CardTitle>
        <CardDescription>What has been offered for this patient</CardDescription>
      </CardHeader>
      <CardContent>
        {plansQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the plans…</p>
        ) : plansQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            The treatment plans could not be loaded.
          </p>
        ) : plans.length > 0 ? (
          <ul className="space-y-3">
            {plans.map((plan) => (
              <li
                key={plan.id}
                data-testid="patient-treatment-plan"
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {plan.title ?? 'Treatment plan'}
                    <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {plan.status.replaceAll('_', ' ')}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground" data-testid="plan-progress">
                    {plan.progress.total} item{plan.progress.total === 1 ? '' : 's'} ·{' '}
                    {plan.progress.completed} complete · {plan.progress.percentComplete}%
                  </span>
                </div>

                {plan.presentedAt && clinicTimeZone ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Presented {formatClinicDay(plan.presentedAt, clinicTimeZone)}
                    {plan.acceptedAt
                      ? ` · accepted ${formatClinicDay(plan.acceptedAt, clinicTimeZone)}`
                      : ''}
                  </p>
                ) : plan.presentedAt && !clinicTimeZone ? (
                  <p className="mt-1 text-xs text-muted-foreground">{READING_THE_CLINIC_CLOCK}</p>
                ) : null}

                <ul className="mt-2 space-y-1">
                  {plan.items.map((item) => (
                    <li
                      key={item.id}
                      data-testid="patient-treatment-plan-item"
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="min-w-0">
                        {item.isCompleted ? (
                          <span aria-hidden className="mr-1">
                            ✓
                          </span>
                        ) : null}
                        {item.tooth ? `Tooth ${item.tooth} · ` : ''}
                        {item.treatmentName ?? item.treatmentCode ?? 'Treatment'}
                        {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatMinorUnits(item.estimatedPriceMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList aria-hidden className="size-4" />
            No treatment plans for this patient yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
