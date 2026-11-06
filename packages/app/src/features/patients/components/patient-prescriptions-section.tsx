/**
 * The prescriptions this patient has been given, newest first.
 *
 * The doctor writes a course on the visit it was handed over on; this card asks
 * the patient-shaped question, because the profile is where a clinician checks
 * what the person was sent home with before prescribing again. The visit remains
 * the subject of the record, so each row links back to it instead of inventing a
 * second prescription detail page.
 *
 * The read is its own query, like the plans and invoices: a failed prescription
 * read is a sentence in this card, not a reason the whole profile cannot open.
 */

import { Pill } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@denti-code-u3/ui';

import { formatClinicDayTime } from '../../clinic/format-clinic-time.js';
import { medicationRouteLabel } from '../../visits/prescription-presentation.js';
import { useTranslation } from '../../../i18n/index.js';
import { usePatientPrescriptions } from '../hooks/use-patients.js';

interface PatientPrescriptionsSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

export function PatientPrescriptionsSection({
  patientId,
  clinicTimeZone,
}: PatientPrescriptionsSectionProps) {
  const { t } = useTranslation();
  const prescriptionsQuery = usePatientPrescriptions(patientId);
  const prescriptions = prescriptionsQuery.data?.prescriptions ?? [];

  return (
    <Card data-testid="patient-prescriptions">
      <CardHeader>
        <CardTitle>{t('patients.prescriptions.title')}</CardTitle>
        <CardDescription>{t('patients.prescriptions.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {prescriptionsQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t('patients.prescriptions.loading')}</p>
        ) : prescriptionsQuery.error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('patients.prescriptions.loadError')}
          </p>
        ) : prescriptions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Pill aria-hidden className="size-4" />
            {t('patients.prescriptions.empty')}
          </p>
        ) : (
          <ul className="space-y-3">
            {prescriptions.map((prescription) => (
              <li
                key={prescription.id}
                data-testid="patient-prescription"
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {prescription.medication} · {prescription.dosage}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {clinicTimeZone
                      ? formatClinicDayTime(prescription.issuedAt, clinicTimeZone)
                      : t('common.readingClinicClock')}
                  </p>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {medicationRouteLabel(t, prescription.route)} · {prescription.frequency}
                  {' · '}
                  {t(
                    prescription.durationDays === 1
                      ? 'visits.prescriptions.duration.one'
                      : 'visits.prescriptions.duration.other',
                    { count: prescription.durationDays },
                  )}
                </p>
                {prescription.instructions ? (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {prescription.instructions}
                  </p>
                ) : null}
                <Link
                  to="/visits/$visitId"
                  params={{ visitId: prescription.visitId }}
                  className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('patients.prescriptions.viewVisit')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
