/**
 * The patient edit form.
 *
 * The same seven fields as registration, prefilled from the record and sent to a
 * different endpoint. Two things are worth knowing about how it differs:
 *
 *  - **Clearing a field is a normal edit.** Emptying the email input submits no
 *    email, and the server stores that as "no email" rather than leaving the old
 *    one in place. That is why the endpoint is a PUT; the alternative was a merge
 *    that could never remove a wrong value.
 *  - **The chart number is not on this form.** It identifies the record the front
 *    desk already quoted to the patient and appears in documents filed under it
 *    (ADR 0015), so it is not editable from any form in this application.
 *
 * The record number is likewise absent from the default values, not merely hidden:
 * the form's type does not contain it, so this component cannot send it.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denti-code-u3/ui';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  updatePatientFormSchema,
  type UpdatePatientFormOutput,
  type UpdatePatientFormValues,
} from '@denti-code-u3/validation';
import type { PatientProfile } from '@denti-code-u3/domain';

import { useUpdatePatient } from '../hooks/use-update-patient.js';
import { describePatientFailure } from '../describe-patient-failure.js';
import { useTranslation } from '../../../i18n/index.js';
import { PatientFields } from './patient-fields.js';

export interface PatientEditFormProps {
  readonly patient: PatientProfile;
  /** Called after the server has stored the edit. */
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}

export function PatientEditForm({ patient, onSaved, onCancel }: PatientEditFormProps) {
  const { t } = useTranslation();
  const update = useUpdatePatient(patient.id);
  const form = useForm<UpdatePatientFormValues, unknown, UpdatePatientFormOutput>({
    resolver: zodResolver(updatePatientFormSchema),
    // String defaults rather than the stored nulls: an uncontrolled input cannot
    // hold `null`, and an empty string is what "the user has not typed this yet"
    // looks like to both the browser and React Hook Form.
    defaultValues: {
      firstName: patient.firstName,
      lastName: patient.lastName,
      preferredName: patient.preferredName ?? '',
      identificationNumber: patient.identificationNumber ?? '',
      phone: patient.phone ?? '',
      email: patient.email ?? '',
      birthDate: patient.birthDate ?? '',
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(values, { onSuccess: onSaved });
  });

  const failure = describePatientFailure(update.error, t('patients.editForm.failure'), {
    validation: t('patients.failure.validation'),
    notFound: t('patients.failure.notFound'),
    conflict: t('patients.failure.conflict'),
    network: t('patients.failure.network'),
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="patient-edit-heading">
      <Card>
        <CardHeader>
          <CardTitle id="patient-edit-heading">{t('patients.editForm.title')}</CardTitle>
          <CardDescription>
            {patient.recordNumber
              ? t('patients.editForm.descriptionWithNumber', {
                  recordNumber: patient.recordNumber,
                })
              : t('patients.editForm.descriptionWithoutNumber')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {failure ? (
            <div
              role="alert"
              data-testid="update-error"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          <PatientFields form={form} disabled={update.isPending} />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending} data-testid="update-submit">
              {update.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('patients.editForm.saving')}
                </>
              ) : (
                t('patients.editForm.save')
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={update.isPending}
              data-testid="update-cancel"
            >
              {t('patients.editForm.cancel')}
            </Button>
            {update.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t('patients.editForm.savingStatus')}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
