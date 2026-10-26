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

import { useSession } from '../session-provider.js';

export function LoginPage(): React.ReactNode {
  const { signIn } = useSession();
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
          ? 'Too many sign-in attempts. Try again later.'
          : 'The email or password is incorrect.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-card">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope aria-hidden className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Denti-Code U3</h1>
          <p className="text-sm text-muted-foreground">Sign in to the clinic workspace</p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} aria-label="Sign in">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
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
            <Label htmlFor="login-password">Password</Label>
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
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
