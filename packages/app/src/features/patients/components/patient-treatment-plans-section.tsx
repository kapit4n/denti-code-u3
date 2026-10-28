/**
 * The patient's treatment plans: what has been offered, and how far it has got.
 *
 * Mounted on the profile beside the odontogram, which is what keeps its one
 * request an answer to something on screen — the same ownership the odontogram
 * section has (its own hook, its own card, no props beyond the patient).
 *
 * **It reads the server's projection, not its own arithmetic.** `progress` on
 * each plan is the API's count of the rows, so the card and the endpoint cannot
 * disagree about how much of a plan is done. A plan's items are named through the
 * treatment the row joins to — `treatmentName` is nullable because the treatment
 * can be deleted under it, and a vanished name renders the code rather than an
 * invented title. The offer and the fact of what was performed are different
 * things; neither rewrites the other.
 *
 * **Two writes live here, and neither is optimistic.** A plan is proposed through
 * {@link NewTreatmentPlanForm}, and a line is marked done through a bodyless POST
 * whose only outcome the section can show is the refetched list. Presenting and
 * accepting a plan are *not* drawn: those are moves on a status whose transitions
 * are not decided yet, and a button for a move the API has no rule for would be a
 * control that lies about what the clinic may do (see `update-treatment-plan`).
 * The server's own answer is what appears after either write, because both
 * invalidate the one key this section read.
 */

import { formatMinorUnits } from '@denti-code-u3/domain';
import { ClipboardList, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denti-code-u3/ui';
import { formatClinicDay } from '../../clinic/format-clinic-time.js';
import { enumLabel, useTranslation } from '../../../i18n/index.js';
import { describePlanItemFailure } from '../describe-plan-item-failure.js';
import { usePatientTreatmentPlans } from '../hooks/use-patients.js';
import { useCompleteTreatmentPlanItem } from '../mutations/use-complete-treatment-plan-item.js';
import { NewTreatmentPlanForm } from './new-treatment-plan-form.js';

interface PatientTreatmentPlansSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

export function PatientTreatmentPlansSection({
  patientId,
  clinicTimeZone,
}: PatientTreatmentPlansSectionProps) {
  const { t } = useTranslation();
  const plansQuery = usePatientTreatmentPlans(patientId);
  const completeItem = useCompleteTreatmentPlanItem();
  const [isProposing, setIsProposing] = useState(false);

  const plans = plansQuery.data?.items ?? [];
  const completeFailure = describePlanItemFailure(
    completeItem.error,
    t('patients.plans.completeError'),
    {
      notFound: t('patients.plans.failure.notFound'),
      network: t('patients.plans.failure.network'),
    },
  );
  const pendingItemId = completeItem.isPending ? completeItem.variables?.itemId : undefined;

  return (
    <Card data-testid="patient-treatment-plans">
      <CardHeader>
        <CardTitle>{t('patients.plans.title')}</CardTitle>
        <CardDescription>{t('patients.plans.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {plansQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t('patients.plans.loading')}</p>
        ) : plansQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('patients.plans.loadError')}
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
                    {plan.title ?? t('patients.plans.fallbackTitle')}
                    <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {enumLabel(t, 'common.status', plan.status)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground" data-testid="plan-progress">
                    {t(
                      plan.progress.total === 1
                        ? 'patients.plans.progress.one'
                        : 'patients.plans.progress.other',
                      {
                        total: plan.progress.total,
                        completed: plan.progress.completed,
                        percent: plan.progress.percentComplete,
                      },
                    )}
                  </span>
                </div>

                {plan.presentedAt && clinicTimeZone ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('patients.plans.presented', {
                      date: formatClinicDay(plan.presentedAt, clinicTimeZone),
                    })}
                    {plan.acceptedAt
                      ? t('patients.plans.accepted', {
                          date: formatClinicDay(plan.acceptedAt, clinicTimeZone),
                        })
                      : ''}
                  </p>
                ) : plan.presentedAt && !clinicTimeZone ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('patients.plans.readingClock')}
                  </p>
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
                        {item.tooth ? t('patients.plans.tooth', { tooth: item.tooth }) : ''}
                        {item.treatmentName ??
                          item.treatmentCode ??
                          t('patients.plans.itemFallback')}
                        {item.quantity > 1
                          ? t('patients.plans.quantity', { count: item.quantity })
                          : ''}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground">
                          {formatMinorUnits(item.estimatedPriceMinor)}
                        </span>
                        {!item.isCompleted ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={completeItem.isPending}
                            data-testid="complete-plan-item"
                            onClick={() =>
                              completeItem.mutate({
                                patientId,
                                planId: plan.id,
                                itemId: item.id,
                              })
                            }
                          >
                            {pendingItemId === item.id ? (
                              <>
                                <Loader2 aria-hidden className="size-3 animate-spin" />
                                {t('patients.plans.markingDone')}
                              </>
                            ) : (
                              t('patients.plans.markDone')
                            )}
                          </Button>
                        ) : null}
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
            {t('patients.plans.empty')}
          </p>
        )}

        {completeFailure ? (
          <div
            role="alert"
            data-testid="complete-plan-item-error"
            className="mt-3 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            {completeFailure}
          </div>
        ) : null}

        {!isProposing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setIsProposing(true)}
            data-testid="new-plan-open"
          >
            <Plus aria-hidden className="size-4" />
            {t('patients.plans.newPlan')}
          </Button>
        ) : (
          <NewTreatmentPlanForm
            patientId={patientId}
            onCreated={() => setIsProposing(false)}
            onCancel={() => setIsProposing(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}
