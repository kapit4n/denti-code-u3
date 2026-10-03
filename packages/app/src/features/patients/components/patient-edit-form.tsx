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

import { useUpdatePatient } from '../hooks/use-update-patient.js';
import { describePatientFailure } from '../describe-patient-failure.js';
import { PatientFields } from './patient-fields.js';
import type { PatientProfile } from '../hooks/use-patients.js';

export interface PatientEditFormProps {
  readonly patient: PatientProfile;
  /** Called after the server has stored the edit. */
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}

export function PatientEditForm({ patient, onSaved, onCancel }: PatientEditFormProps) {
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

  const failure = describePatientFailure(
    update.error,
    'The changes could not be saved. Try again.',
  );

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="patient-edit-heading">
      <Card>
        <CardHeader>
          <CardTitle id="patient-edit-heading">Edit patient details</CardTitle>
          <CardDescription>
            Clear a field to remove it from the record. The record number
            {patient.recordNumber ? ` (${patient.recordNumber})` : ''} is assigned by the clinic and
            cannot be changed here.
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
                  Saving
                </>
              ) : (
                'Save changes'
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={update.isPending}
              data-testid="update-cancel"
            >
              Cancel
            </Button>
            {update.isPending ? (
              <p className="text-sm text-muted-foreground" role="status">
                Saving…
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
