/**
 * The login screen.
 *
 * The only screen reachable without a session. It collects an email and a
 * password, calls `signIn`, and shows one message for every credential failure —
 * the same "the email or password is incorrect" the API produces, because telling
 * an operator "no such user" turns the login form into a directory of the clinic's
 * staff. Being throttled is not a credential failure and says so, otherwise the
 * operator would keep retyping a correct password.
 *
 * It does not validate the email shape beyond `type="email"`: a stricter client
 * check would only make it harder to log in with an address the server accepts,
 * and the server is the one that decides.
 */

import { useState, type FormEvent } from 'react';
import { ApiClientError } from '@denti-code-u3/api-client';
import { Button, Input, Label } from '@denti-code-u3/ui';
import { Stethoscope } from 'lucide-react';

import { useTranslation, type Translate, type TranslationKey } from '../../../i18n/index.js';
import type { SessionUser } from '../session-storage.js';
import { useSession } from '../session-provider.js';
import { useDevUsers } from '../queries/use-dev-users.js';

export function LoginPage(): React.ReactNode {
  const { t } = useTranslation();
  const { signIn, signInAs } = useSession();
  const devUsers = useDevUsers();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await signIn({ email, password });
      // On success the guard re-renders the app; nothing to navigate here.
    } catch (error) {
      setError(
        error instanceof ApiClientError && error.code === 'RATE_LIMITED'
          ? t('auth.signIn.rateLimited')
          : t('auth.signIn.invalid'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onDevLogin(userId: string): Promise<void> {
    setError(undefined);
    setSubmitting(true);
    try {
      await signInAs(userId);
    } catch {
      setError(t('auth.dev.failure'));
    } finally {
      setSubmitting(false);
    }
  }

  const devUserList = devUsers.data?.items ?? [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-card">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope aria-hidden className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Denti-Code U3</h1>
          <p className="text-sm text-muted-foreground">{t('auth.signIn.subtitle')}</p>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={onSubmit}
          aria-label={t('auth.signIn.formAria')}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">{t('auth.signIn.email')}</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">{t('auth.signIn.password')}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
          </Button>
        </form>

        {devUserList.length > 0 ? (
          <>
            <div className="my-6 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                {t('auth.dev.title')}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-2" data-testid="dev-login">
              <p className="text-xs text-muted-foreground">{t('auth.dev.description')}</p>
              {devUserList.map((user) => (
                <Button
                  key={user.id}
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => void onDevLogin(user.id)}
                  className="w-full justify-between"
                >
                  <span className="truncate">
                    {t('auth.dev.signInAs', { name: user.fullName })}
                  </span>
                  <span className="text-xs text-muted-foreground">{roleLabel(t, user.role)}</span>
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const ROLE_KEY: Readonly<Record<SessionUser['role'], TranslationKey>> = {
  ADMINISTRATOR: 'auth.role.ADMINISTRATOR',
  DENTIST: 'auth.role.DENTIST',
  ASSISTANT: 'auth.role.ASSISTANT',
  RECEPTIONIST: 'auth.role.RECEPTIONIST',
};

function roleLabel(t: Translate, role: SessionUser['role']): string {
  return t(ROLE_KEY[role]);
}
