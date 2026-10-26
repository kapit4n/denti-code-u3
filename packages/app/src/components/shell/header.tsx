import { LogOut } from 'lucide-react';

import { Button } from '@denti-code-u3/ui';
import { ThemeToggle } from '../../features/theme/theme-toggle.js';
import { GlobalPatientSearch } from '../../features/patients/components/global-patient-search.js';
import { useSession } from '../../features/auth/session-provider.js';

/**
 * The application header.
 *
 * Two controls and no more: the global patient search and the theme toggle. The
 * notification bell and the account avatar that used to sit on the right are gone,
 * not hidden — neither had an implementation behind it (there is no notification
 * system and no authentication), and a control that looks live but does nothing is
 * worse than one that is absent. They return when there is something real for them
 * to open.
 */
export function Header() {
  const { user, signOut } = useSession();

  return (
    <div className="flex h-16 items-center justify-between gap-4 border-b bg-background px-6">
      <div className="flex flex-1 items-center">
        <GlobalPatientSearch />
      </div>
      <div className="flex items-center gap-2">
        {user ? (
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <span className="max-w-40 truncate">{user.fullName}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs uppercase tracking-wide">
              {user.role}
            </span>
          </div>
        ) : null}
        <ThemeToggle />
        <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
