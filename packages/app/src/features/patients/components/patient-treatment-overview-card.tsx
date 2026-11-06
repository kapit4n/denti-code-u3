/**
 * The patient's open planned work, split into what has started and what has not.
 *
 * The profile already carries the whole clinical context in one request. This card
 * turns its outstanding-treatment projection into the question a clinician asks
 * before an appointment: which work is already in progress, and which work is
 * still waiting for its first session?
 *
 * The server decides which lines are open and how many sessions each has. The card
 * only groups them — no second treatment-plan read, no arithmetic about completion.
 */

import type { PatientOutstandingTreatment } from '@denti-code-u3/domain';
import { formatMinorUnits } from '@denti-code-u3/domain';
import { ClipboardList } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { useTranslation } from '../../../i18n/index.js';

interface PatientTreatmentOverviewCardProps {
  readonly treatments: readonly PatientOutstandingTreatment[];
}

export function PatientTreatmentOverviewCard({ treatments }: PatientTreatmentOverviewCardProps) {
  const { t } = useTranslation();
  const inProgress = treatments.filter((item) => item.sessionCount > 0);
  const pending = treatments.filter((item) => item.sessionCount === 0);

  return (
    <Card data-testid="patient-treatment-overview">
      <CardHeader>
        <CardTitle>{t('patients.profile.treatmentOverview')}</CardTitle>
        <CardDescription>{t('patients.profile.treatmentOverviewDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {treatments.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList aria-hidden className="size-4" />
            {t('patients.profile.nothingOutstanding')}
          </p>
        ) : (
          <>
            <TreatmentGroup
              title={t('patients.profile.inProgressTreatments', { count: inProgress.length })}
              empty={t('patients.profile.noTreatmentsInProgress')}
              treatments={inProgress}
            />
            <TreatmentGroup
              title={t('patients.profile.pendingTreatments', { count: pending.length })}
              empty={t('patients.profile.noPendingTreatments')}
              treatments={pending}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TreatmentGroup({
  title,
  empty,
  treatments,
}: {
  readonly title: string;
  readonly empty: string;
  readonly treatments: readonly PatientOutstandingTreatment[];
}) {
  const { t } = useTranslation();

  return (
    <section className="space-y-2" data-testid="patient-treatment-group">
      <h3 className="font-medium">{title}</h3>
      {treatments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {treatments.map((item) => (
            <li
              key={item.id}
              data-testid="patient-treatment-overview-item"
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {item.tooth ? t('patients.profile.tooth', { tooth: item.tooth }) : ''}
                  {item.treatmentName?.trim() ||
                    item.treatmentCode ||
                    t('patients.profile.planItemFallback')}
                  {item.quantity > 1
                    ? t('patients.profile.quantity', { count: item.quantity })
                    : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.title?.trim() || t('patients.profile.planItemFallback')}
                  {item.sessionCount > 0
                    ? ` · ${t(
                        item.sessionCount === 1
                          ? 'patients.profile.treatmentSessions.one'
                          : 'patients.profile.treatmentSessions.other',
                        { count: item.sessionCount },
                      )}`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 text-muted-foreground">
                {formatMinorUnits(item.estimatedPriceMinor)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
