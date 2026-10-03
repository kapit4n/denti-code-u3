import { Button } from '@denti-code-u3/ui';
import { Bell, User } from 'lucide-react';
import { ThemeToggle } from '../../features/theme/theme-toggle.js';
import { GlobalPatientSearch } from '../../features/patients/components/global-patient-search.js';

export function Header() {
  return (
    <div className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4">
      <div className="flex flex-1 items-center">
        <GlobalPatientSearch />
      </div>
      <div className="flex items-center space-x-2">
        <ThemeToggle />
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
        </Button>
        <Button variant="ghost" size="icon">
          <User className="h-5 w-5" />
          <span className="sr-only">User menu</span>
        </Button>
      </div>
    </div>
  );
}
