/**
 * The patient registration form.
 *
 * React Hook Form with a Zod resolver, because the alternative — validating in a
 * `useEffect` or inside the submit handler — means the rules exist twice and
 * drift. The resolver is `createPatientFormSchema`, whose fields are the same
 * schema objects `createPatientSchema` uses, so a field cannot be accepted here
 * and rejected by the API.
 *
 * The component holds no business rules of its own (rule 1): it collects values,
 * asks the mutation to store them, and reports what came back. The record number
 * is not an input — it is assigned per clinic by the server, and the receptionist
 * reads it out from the confirmation rather than typing it.
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
  createPatientFormSchema,
  type CreatePatientFormOutput,
  type CreatePatientFormValues,
} from '@denti-code-u3/validation';

import { useRegisterPatient } from '../hooks/use-register-patient.js';
import { describePatientFailure } from '../describe-patient-failure.js';
import { useTranslation } from '../../../i18n/index.js';
import { PatientFields } from './patient-fields.js';

export interface PatientFormProps {
  /** Called after a successful registration, with the new patient and number. */
  readonly onRegistered: (patient: { readonly id: string; readonly recordNumber: string }) => void;
}

export function PatientForm({ onRegistered }: PatientFormProps) {
  const { t } = useTranslation();
  const register = useRegisterPatient();
  const form = useForm<CreatePatientFormValues, unknown, CreatePatientFormOutput>({
    resolver: zodResolver(createPatientFormSchema),
    // Prefilled with empty strings rather than left undefined: a controlled input
    // that starts as `undefined` flickers from empty to empty on first render.
    defaultValues: {
      firstName: '',
      lastName: '',
      preferredName: '',
      identificationNumber: '',
      phone: '',
      email: '',
      birthDate: '',
      allergies: '',
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    register.mutate(values, {
      onSuccess: (created) => {
        form.reset();
        onRegistered({ id: created.id, recordNumber: created.recordNumber });
      },
    });
  });

  const failure = describePatientFailure(register.error, t('patients.form.failure'), {
    validation: t('patients.failure.validation'),
    notFound: t('patients.failure.notFound'),
    conflict: t('patients.failure.conflict'),
    network: t('patients.failure.network'),
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="patient-form-heading">
      <Card>
        <CardHeader>
          <CardTitle id="patient-form-heading">{t('patients.form.title')}</CardTitle>
          <CardDescription>{t('patients.form.description')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/*
            `role="alert"` so the failure is announced. Without it the message
            appears silently and the form looks simply stuck.
          */}
          {failure ? (
            <div
              role="alert"
              data-testid="register-error"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          <PatientFields form={form} disabled={register.isPending} />

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={register.isPending} data-testid="register-submit">
              {register.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('patients.form.registering')}
                </>
              ) : (
                t('patients.form.register')
              )}
            </Button>
            {register.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t('patients.form.saving')}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
