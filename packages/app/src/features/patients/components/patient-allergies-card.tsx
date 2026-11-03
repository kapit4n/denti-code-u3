import { useState, type FormEvent } from 'react';
import type { PatientProfile } from '@denti-code-u3/domain';
import type { UpdatePatientInput } from '@denti-code-u3/validation';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@denti-code-u3/ui';
import { AlertCircle, Loader2, Plus } from 'lucide-react';

import { useTranslation } from '../../../i18n/index.js';
import { describePatientFailure } from '../describe-patient-failure.js';
import { useUpdatePatient } from '../hooks/use-update-patient.js';

export interface PatientAllergiesCardProps {
  readonly patient: PatientProfile;
}

export function withAddedAllergy(existing: string | null, allergy: string): string {
  const value = allergy.trim();
  const current = existing?.trim() ?? '';

  if (!current) {
    return value;
  }

  const alreadyListed = current
    .split(/[,;]/)
    .map((entry) => entry.trim().toLocaleLowerCase())
    .includes(value.toLocaleLowerCase());

  return alreadyListed ? current : `${current}, ${value}`;
}

function editableDetails(patient: PatientProfile, allergies: string): UpdatePatientInput {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    ...(patient.preferredName ? { preferredName: patient.preferredName } : {}),
    ...(patient.identificationNumber ? { identificationNumber: patient.identificationNumber } : {}),
    ...(patient.phone ? { phone: patient.phone } : {}),
    ...(patient.email ? { email: patient.email } : {}),
    ...(patient.birthDate ? { birthDate: patient.birthDate } : {}),
    allergies,
  };
}

export function PatientAllergiesCard({ patient }: PatientAllergiesCardProps) {
  const { t } = useTranslation();
  const update = useUpdatePatient(patient.id);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const failure = describePatientFailure(update.error, t('patients.profile.addAllergyFailure'), {
    validation: t('patients.failure.validation'),
    notFound: t('patients.failure.notFound'),
    conflict: t('patients.failure.conflict'),
    network: t('patients.failure.network'),
  });

  const close = () => {
    setDraft('');
    setIsAdding(false);
    update.reset();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const allergy = draft.trim();
    if (!allergy) {
      return;
    }

    update.mutate(editableDetails(patient, withAddedAllergy(patient.allergies, allergy)), {
      onSuccess: close,
    });
  };

  return (
    <Card
      className={patient.allergies ? 'border-destructive/50' : undefined}
      data-testid="patient-allergies"
    >
      <CardHeader>
        <CardTitle>{t('patients.profile.allergies')}</CardTitle>
        <CardDescription>{t('patients.profile.allergiesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {patient.allergies ? (
          <p className="font-medium text-destructive">{patient.allergies}</p>
        ) : (
          <p className="text-muted-foreground">{t('patients.profile.allergiesNone')}</p>
        )}

        {isAdding ? (
          <form className="space-y-2" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <Label htmlFor="patient-allergy">{t('patients.profile.allergyLabel')}</Label>
              <Input
                id="patient-allergy"
                data-testid="allergy-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('patients.fields.allergiesPlaceholder')}
                autoFocus
                maxLength={1000}
                disabled={update.isPending}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={update.isPending || draft.trim().length === 0}
                data-testid="allergy-submit"
              >
                {update.isPending ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    {t('patients.profile.addAllergySaving')}
                  </>
                ) : (
                  t('patients.profile.addAllergySave')
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={close}
                disabled={update.isPending}
              >
                {t('patients.profile.addAllergyCancel')}
              </Button>
              {update.isPending ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('patients.profile.addAllergySavingStatus')}
                </p>
              ) : null}
            </div>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsAdding(true)}
            data-testid="add-allergy"
          >
            <Plus aria-hidden className="size-4" />
            {t('patients.profile.addAllergy')}
          </Button>
        )}

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
