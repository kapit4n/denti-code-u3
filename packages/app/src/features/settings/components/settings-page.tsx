import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm } from 'react-hook-form';
import { ApiClientError } from '@denti-code-u3/api-client';
import type { Clinic } from '@denti-code-u3/domain';
import {
  updateClinicSettingsSchema,
  type UpdateClinicSettingsInput,
} from '@denti-code-u3/validation';
import { AlertCircle, Loader2, Save } from 'lucide-react';
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

import { useTranslation, type TranslationKey } from '../../../i18n/index.js';
import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { useUpdateClinicSettings } from '../../clinic/mutations/use-update-clinic-settings.js';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const WEEKDAY_KEYS: Readonly<Record<number, TranslationKey>> = {
  1: 'settings.hours.day.1',
  2: 'settings.hours.day.2',
  3: 'settings.hours.day.3',
  4: 'settings.hours.day.4',
  5: 'settings.hours.day.5',
  6: 'settings.hours.day.6',
  7: 'settings.hours.day.7',
};

function defaultValues(clinic?: Clinic): UpdateClinicSettingsInput {
  const stored = new Map((clinic?.operatingHours ?? []).map((hours) => [hours.weekday, hours]));

  return {
    name: clinic?.name ?? '',
    legalName: clinic?.legalName ?? null,
    taxId: clinic?.taxId ?? null,
    address: clinic?.address ?? null,
    phone: clinic?.phone ?? null,
    email: clinic?.email ?? null,
    timeZone: clinic?.timeZone ?? 'America/Lima',
    currency: clinic?.currency ?? 'USD',
    operatingHours: WEEKDAYS.map((weekday) => {
      const hours = stored.get(weekday);
      return {
        weekday,
        opensAtLocalTime: hours?.opensAtLocalTime ?? '',
        closesAtLocalTime: hours?.closesAtLocalTime ?? '',
        isClosed: hours?.isClosed ?? true,
      };
    }),
  };
}

export function SettingsPage() {
  const { t } = useTranslation();
  const clinicQuery = useClinicSettings();

  if (clinicQuery.isPending) {
    return <p className="text-sm text-muted-foreground">{t('settings.loading')}</p>;
  }

  if (clinicQuery.isError) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
      >
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-2">
          <p>{t('settings.loadFailure')}</p>
          <Button type="button" variant="outline" onClick={() => void clinicQuery.refetch()}>
            {t('settings.retry')}
          </Button>
        </div>
      </div>
    );
  }

  return <ClinicSettingsForm clinic={clinicQuery.data} />;
}

function ClinicSettingsForm({ clinic }: { readonly clinic: Clinic }) {
  const { t } = useTranslation();
  const update = useUpdateClinicSettings();
  const form = useForm<UpdateClinicSettingsInput>({
    resolver: zodResolver(updateClinicSettingsSchema),
    defaultValues: defaultValues(clinic),
  });
  const hours = useFieldArray({ control: form.control, name: 'operatingHours' });
  const watchedHours = form.watch('operatingHours');

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(values, {
      onSuccess: (saved) => form.reset(defaultValues(saved)),
    });
  });

  const failure = describeSettingsFailure(update.error, t);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.description')}</p>
      </header>

      <form className="space-y-6" onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.identity.title')}</CardTitle>
            <CardDescription>{t('settings.identity.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="clinic-name"
                label={t('settings.field.name')}
                error={form.formState.errors.name?.message}
              >
                <Input
                  id="clinic-name"
                  data-testid="settings-name"
                  {...form.register('name')}
                  disabled={update.isPending}
                  maxLength={200}
                />
              </Field>

              <Field
                id="clinic-legal-name"
                label={t('settings.field.legalName')}
                error={form.formState.errors.legalName?.message}
              >
                <Input
                  id="clinic-legal-name"
                  data-testid="settings-legal-name"
                  {...form.register('legalName')}
                  disabled={update.isPending}
                  maxLength={200}
                />
              </Field>

              <Field
                id="clinic-tax-id"
                label={t('settings.field.taxId')}
                error={form.formState.errors.taxId?.message}
              >
                <Input
                  id="clinic-tax-id"
                  data-testid="settings-tax-id"
                  {...form.register('taxId')}
                  disabled={update.isPending}
                  maxLength={50}
                />
              </Field>

              <Field
                id="clinic-email"
                label={t('settings.field.email')}
                error={form.formState.errors.email?.message}
              >
                <Input
                  id="clinic-email"
                  data-testid="settings-email"
                  type="email"
                  {...form.register('email')}
                  disabled={update.isPending}
                  maxLength={200}
                />
              </Field>

              <Field
                id="clinic-phone"
                label={t('settings.field.phone')}
                error={form.formState.errors.phone?.message}
              >
                <Input
                  id="clinic-phone"
                  data-testid="settings-phone"
                  {...form.register('phone')}
                  disabled={update.isPending}
                  maxLength={50}
                />
              </Field>

              <Field
                id="clinic-address"
                label={t('settings.field.address')}
                error={form.formState.errors.address?.message}
              >
                <Input
                  id="clinic-address"
                  data-testid="settings-address"
                  {...form.register('address')}
                  disabled={update.isPending}
                  maxLength={500}
                />
              </Field>

              <Field
                id="clinic-time-zone"
                label={t('settings.field.timeZone')}
                hint={t('settings.field.timeZoneHint')}
                error={form.formState.errors.timeZone?.message}
              >
                <Input
                  id="clinic-time-zone"
                  data-testid="settings-time-zone"
                  {...form.register('timeZone')}
                  disabled={update.isPending}
                  maxLength={100}
                />
              </Field>

              <Field
                id="clinic-currency"
                label={t('settings.field.currency')}
                hint={t('settings.field.currencyHint')}
                error={form.formState.errors.currency?.message}
              >
                <Input
                  id="clinic-currency"
                  data-testid="settings-currency"
                  {...form.register('currency')}
                  disabled={update.isPending}
                  maxLength={3}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.hours.title')}</CardTitle>
            <CardDescription>{t('settings.hours.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {hours.fields.map((field, index) => {
                const isClosed = watchedHours[index]?.isClosed === true;

                return (
                  <div
                    key={field.id}
                    data-testid="settings-hours-row"
                    className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                  >
                    <input
                      type="hidden"
                      {...form.register(`operatingHours.${index}.weekday`, {
                        valueAsNumber: true,
                      })}
                    />
                    <p className="font-medium">
                      {t(WEEKDAY_KEYS[field.weekday] ?? 'settings.hours.closed')}
                    </p>

                    <Field
                      id={`settings-opens-${index}`}
                      label={t('settings.hours.opensAt')}
                      error={
                        form.formState.errors.operatingHours?.[index]?.opensAtLocalTime?.message
                      }
                    >
                      <Input
                        id={`settings-opens-${index}`}
                        data-testid={`settings-opens-${index}`}
                        type="time"
                        {...form.register(`operatingHours.${index}.opensAtLocalTime`)}
                        disabled={update.isPending || isClosed}
                      />
                    </Field>

                    <Field
                      id={`settings-closes-${index}`}
                      label={t('settings.hours.closesAt')}
                      error={
                        form.formState.errors.operatingHours?.[index]?.closesAtLocalTime?.message
                      }
                    >
                      <Input
                        id={`settings-closes-${index}`}
                        data-testid={`settings-closes-${index}`}
                        type="time"
                        {...form.register(`operatingHours.${index}.closesAtLocalTime`)}
                        disabled={update.isPending || isClosed}
                      />
                    </Field>

                    <label className="flex h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        data-testid={`settings-closed-${index}`}
                        {...form.register(`operatingHours.${index}.isClosed`)}
                        disabled={update.isPending}
                      />
                      {t('settings.hours.closed')}
                    </label>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {failure ? (
          <div
            role="alert"
            data-testid="settings-failure"
            className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending} data-testid="settings-save">
            {update.isPending ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t('settings.saving')}
              </>
            ) : (
              <>
                <Save aria-hidden className="size-4" />
                {t('settings.save')}
              </>
            )}
          </Button>
          {update.isSuccess ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('settings.saved')}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describeSettingsFailure(
  error: unknown,
  t: (key: TranslationKey) => string,
): string | undefined {
  if (!error) {
    return undefined;
  }
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK_ERROR') {
      return t('settings.failure.network');
    }
    if (error.code === 'FORBIDDEN') {
      return t('settings.failure.forbidden');
    }
    if (error.code === 'VALIDATION_ERROR') {
      return t('settings.failure.validation');
    }
  }
  return t('settings.failure');
}
