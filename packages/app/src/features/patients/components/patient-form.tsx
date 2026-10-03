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
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
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
import { AlertCircle, Loader2 } from 'lucide-react';
import type { ApiClientError } from '@denti-code-u3/api-client';
import {
  createPatientFormSchema,
  type CreatePatientFormOutput,
  type CreatePatientFormValues,
} from '@denti-code-u3/validation';

import { useRegisterPatient } from '../hooks/use-register-patient.js';

export interface PatientFormProps {
  /** Called after a successful registration, with the new patient and number. */
  readonly onRegistered: (patient: { readonly id: string; readonly recordNumber: string }) => void;
}

export function PatientForm({ onRegistered }: PatientFormProps) {
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

  const failure = describeFailure(register.error);

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="patient-form-heading">
      <Card>
        <CardHeader>
          <CardTitle id="patient-form-heading">Patient details</CardTitle>
          <CardDescription>
            First and last name are required. The rest can be added later.
          </CardDescription>
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

          <fieldset className="space-y-6" disabled={register.isPending}>
            <legend className="sr-only">Identity</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="firstName"
                label="First name"
                autoComplete="given-name"
                registration={form.register('firstName')}
                error={form.formState.errors.firstName?.message}
              />
              <Field
                id="lastName"
                label="Last name"
                autoComplete="family-name"
                registration={form.register('lastName')}
                error={form.formState.errors.lastName?.message}
              />
              <Field
                id="preferredName"
                label="Preferred name"
                hint="How they would like to be addressed"
                registration={form.register('preferredName')}
                error={form.formState.errors.preferredName?.message}
              />
              <Field
                id="identificationNumber"
                label="Identification number"
                registration={form.register('identificationNumber')}
                error={form.formState.errors.identificationNumber?.message}
              />
            </div>

            <legend className="sr-only">Contact and birth date</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="phone"
                label="Phone"
                type="tel"
                autoComplete="tel"
                registration={form.register('phone')}
                error={form.formState.errors.phone?.message}
              />
              <Field
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                registration={form.register('email')}
                error={form.formState.errors.email?.message}
              />
              <Field
                id="birthDate"
                label="Date of birth"
                type="date"
                registration={form.register('birthDate')}
                error={form.formState.errors.birthDate?.message}
              />
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={register.isPending} data-testid="register-submit">
              {register.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Registering
                </>
              ) : (
                'Register patient'
              )}
            </Button>
            {register.isPending ? (
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

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly type?: string;
  readonly autoComplete?: string;
  /** React Hook Form's register result: name, onChange, onBlur and the ref. */
  readonly registration: UseFormRegisterReturn;
}

/**
 * A labelled input with its hint and error wired up for assistive technology.
 *
 * `aria-describedby` and `aria-invalid` go on the input rather than a wrapper
 * element: on a div they are inert, so a screen reader would announce a text box
 * as valid while it silently refuses to submit.
 */
function Field({ id, label, hint, error, type, autoComplete, registration }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...registration}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Turn a failed request into one sentence the receptionist can act on.
 *
 * A 422 means the API rejected a rule the form does not know about — a birth
 * date in the future, most likely. Showing that message beats "something went
 * wrong", because the server already knows what is wrong.
 */
function describeFailure(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }

  const apiError = error as Partial<ApiClientError>;

  switch (apiError.code) {
    case 'VALIDATION_ERROR':
    case 'DOMAIN_RULE_VIOLATION':
      return apiError.message ?? 'Some of these details are not valid.';
    case 'SCHEDULING_CONFLICT':
      return apiError.message ?? 'That record already exists.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Check the connection and try again.';
    default:
      return apiError.message ?? 'The patient could not be registered. Try again.';
  }
}
