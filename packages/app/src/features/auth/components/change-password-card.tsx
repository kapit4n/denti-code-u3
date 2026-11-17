import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiClientError } from '@denti-code-u3/api-client';
import { changePasswordSchema } from '@denti-code-u3/validation';
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
import { useChangePassword } from '../mutations/use-change-password.js';

const formSchema = changePasswordSchema.extend({
  confirmPassword: z.string().min(1),
});

type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordCard() {
  const { t } = useTranslation();
  const [mismatch, setMismatch] = useState(false);
  const change = useChangePassword();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const failure = describeFailure(change.error, t);

  const onSubmit = form.handleSubmit((values) => {
    if (values.newPassword !== values.confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      { onSuccess: () => form.reset() },
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.password.title')}</CardTitle>
        <CardDescription>{t('settings.password.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <PasswordField
            id="current-password"
            testId="password-current"
            label={t('settings.password.current')}
            error={form.formState.errors.currentPassword?.message}
          >
            <Input
              id="current-password"
              data-testid="password-current"
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
              disabled={change.isPending}
            />
          </PasswordField>

          <PasswordField
            id="new-password"
            testId="password-new"
            label={t('settings.password.new')}
            hint={t('settings.password.hint')}
            error={form.formState.errors.newPassword?.message}
          >
            <Input
              id="new-password"
              data-testid="password-new"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
              disabled={change.isPending}
            />
          </PasswordField>

          <PasswordField
            id="confirm-password"
            testId="password-confirm"
            label={t('settings.password.confirm')}
            error={
              mismatch
                ? t('settings.password.mismatch')
                : form.formState.errors.confirmPassword?.message
            }
          >
            <Input
              id="confirm-password"
              data-testid="password-confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
              disabled={change.isPending}
            />
          </PasswordField>

          {failure ? (
            <div
              role="alert"
              data-testid="password-failure"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={change.isPending} data-testid="password-submit">
              {change.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('settings.password.saving')}
                </>
              ) : (
                <>
                  <Save aria-hidden className="size-4" />
                  {t('settings.password.submit')}
                </>
              )}
            </Button>
            {change.isSuccess ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('settings.password.saved')}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordField({
  id,
  testId,
  label,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly testId: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="space-y-1" data-testid={`${testId}-field`}>
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

function describeFailure(error: unknown, t: (key: TranslationKey) => string): string | undefined {
  if (!error) {
    return undefined;
  }
  if (error instanceof ApiClientError) {
    if (error.code === 'UNAUTHENTICATED') {
      return t('settings.password.failure.current');
    }
    if (error.code === 'VALIDATION_ERROR') {
      return t('settings.password.failure.validation');
    }
    if (error.code === 'RATE_LIMITED') {
      return t('settings.password.failure.rateLimited');
    }
    if (error.code === 'NETWORK_ERROR') {
      return t('settings.password.failure.network');
    }
  }
  return t('settings.password.failure');
}
