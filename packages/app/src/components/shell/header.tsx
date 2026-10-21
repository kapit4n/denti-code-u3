import { ThemeToggle } from '../../features/theme/theme-toggle.js';
import { GlobalPatientSearch } from '../../features/patients/components/global-patient-search.js';

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
  return (
    <div className="flex h-16 items-center justify-between gap-4 border-b bg-background px-6">
      <div className="flex flex-1 items-center">
        <GlobalPatientSearch />
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
      </div>
    </div>
  );
}
