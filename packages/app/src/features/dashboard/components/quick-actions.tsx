/**
 * The dashboard's primary actions.
 *
 * Each action declares where it goes; one that has no destination yet is rendered
 * disabled with the reason, rather than silently doing nothing. A button that
 * looks live but navigates nowhere is worse than one that admits it is not ready.
 */

import { Link } from '@tanstack/react-router';
import { Button } from '@denti-code-u3/ui';
import { CalendarPlus, UserPlus, type LucideIcon } from 'lucide-react';

interface QuickAction {
  readonly key: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly to?: string;
  readonly reason?: string;
}

const ACTIONS: readonly QuickAction[] = [
  {
    key: 'new-visit',
    label: 'New Visit',
    Icon: CalendarPlus,
    reason: 'Available with the agenda (Milestone 5)',
  },
  {
    key: 'new-patient',
    label: 'New Patient',
    Icon: UserPlus,
    to: '/patients/new',
  },
];

export function QuickActions() {
  return (
    <div className="flex gap-2">
      {ACTIONS.map(({ key, label, Icon, to, reason }) =>
        to ? (
          <Button key={key} asChild>
            <Link to={to}>
              <Icon aria-hidden className="mr-2 h-4 w-4" />
              {label}
            </Link>
          </Button>
        ) : (
          <Button key={key} disabled title={reason}>
            <Icon aria-hidden className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ),
      )}
    </div>
  );
}
