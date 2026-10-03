/**
 * The patient detail fields, and the input they are drawn with.
 *
 * Registration and editing are the same seven fields with two different questions
 * attached: "create this patient" and "this is what the patient has". Duplicating
 * the markup would mean a fix to the date input, the autocomplete token or the
 * error wiring landed in one form and not the other, and the two would drift within
 * a release. So the fields live here once and both forms compose them.
 *
 * This component holds no business rules (rule 1). Validation belongs to the Zod
 * schema the form is built on; all these fields do is bind an input to a form
 * field and wire up its label, hint and error for assistive technology.
 */

import { Input, Label } from '@denti-code-u3/ui';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { CreatePatientFormValues, UpdatePatientFormValues } from '@denti-code-u3/validation';

/**
 * Both form schemas accept the same seven fields, so one component type covers
 * both forms without a cast at the call site.
 */
export type PatientFieldValues = CreatePatientFormValues | UpdatePatientFormValues;

export interface PatientFieldsProps<T extends PatientFieldValues> {
  readonly form: {
    register: (name: keyof T & string) => UseFormRegisterReturn;
    readonly formState: {
      readonly errors: Partial<Record<keyof T, { readonly message?: string } | undefined>>;
    };
  };
  /**
   * Disables every field while a write is in flight. Two requests from one form
   * are almost never what the user meant, and the second would race the first.
   */
  readonly disabled?: boolean;
}

export function PatientFields<T extends PatientFieldValues>({
  form,
  disabled,
}: PatientFieldsProps<T>) {
  const error = (name: keyof T & string) => form.formState.errors[name]?.message;

  return (
    <>
      <fieldset className="space-y-6" disabled={disabled}>
        <legend className="sr-only">Identity</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="firstName"
            label="First name"
            autoComplete="given-name"
            registration={form.register('firstName')}
            error={error('firstName')}
          />
          <Field
            id="lastName"
            label="Last name"
            autoComplete="family-name"
            registration={form.register('lastName')}
            error={error('lastName')}
          />
          <Field
            id="preferredName"
            label="Preferred name"
            hint="How they would like to be addressed"
            registration={form.register('preferredName')}
            error={error('preferredName')}
          />
          <Field
            id="identificationNumber"
            label="Identification number"
            registration={form.register('identificationNumber')}
            error={error('identificationNumber')}
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
            error={error('phone')}
          />
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            registration={form.register('email')}
            error={error('email')}
          />
          <Field
            id="birthDate"
            label="Date of birth"
            type="date"
            registration={form.register('birthDate')}
            error={error('birthDate')}
          />
        </div>
      </fieldset>
    </>
  );
}

export interface FieldProps {
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
export function Field({ id, label, hint, error, type, autoComplete, registration }: FieldProps) {
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
