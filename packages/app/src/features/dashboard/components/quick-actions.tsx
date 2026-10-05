/**
 * The dashboard's primary actions.
 *
 * Each action declares what it does: where it goes, or what it opens. Both are real —
 * the "not ready yet" placeholder is gone now that booking works from here, and it is
 * not coming back as a category: a button that looks live but goes nowhere is worse
 * than one that admits it is not ready, so if an action cannot do either it should not
 * be rendered at all.
 */

import { Link } from '@tanstack/react-router';
import { Button } from '@denti-code-u3/ui';
import { CalendarPlus, UserPlus, type LucideIcon } from 'lucide-react';

interface QuickAction {
  readonly key: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  /** A page to go to. */
  readonly to?: string;
  /** Something to open, for an action that is not a navigation. */
  readonly onClick?: () => void;
}

export function QuickActions({ onNewVisit }: { readonly onNewVisit: () => void }) {
  /**
   * Declared here rather than at module scope because one of them is this component's
   * prop. That is also the honest shape: the dashboard owns *when* the booking dialog
   * opens, and the list is a rendering of that decision, not a config file that reaches
   * around it.
   *
   * **"New Visit" opens the booking dialog; "New Patient" navigates.** Two different
   * kinds of action in one row of buttons, which is why the handler is a prop and not a
   * route: the dialog has no URL of its own — it is a modal over whatever page opened
   * it — and a dashboard that pushed `/dashboard?book=1` to reach one would have to
   * hold that parameter, keep it in step with the dialog and answer for it on refresh.
   * Linking to the agenda instead would send the receptionist to a grid she then has to
   * find the right empty slot on.
   */
  const actions: readonly QuickAction[] = [
    { key: 'new-visit', label: 'New Visit', Icon: CalendarPlus, onClick: onNewVisit },
    { key: 'new-patient', label: 'New Patient', Icon: UserPlus, to: '/patients/new' },
  ];

  return (
    <div className="flex gap-2">
      {actions.map(({ key, label, Icon, to, onClick }) =>
        to ? (
          <Button key={key} asChild>
            <Link to={to}>
              <Icon aria-hidden className="mr-2 h-4 w-4" />
              {label}
            </Link>
          </Button>
        ) : (
          <Button key={key} onClick={onClick} data-testid="new-visit">
            <Icon aria-hidden className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ),
      )}
    </div>
  );
}
