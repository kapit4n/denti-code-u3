/**
 * The dashboard's primary actions.
 *
 * Both actions are disabled with an explanatory title rather than silently
 * doing nothing: creating a patient and booking a visit are Milestone 4/5 work,
 * and a button that looks live but navigates nowhere is worse than one that says
 * it is not ready yet. Enabling them is a one-line change per button when the
 * target routes exist.
 */

import { Button } from '@denti-code-u3/ui';
import { CalendarPlus, UserPlus } from 'lucide-react';

const PENDING_ACTIONS = [
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
    reason: 'Available with patient registration (Milestone 4)',
  },
] as const;

export function QuickActions() {
  return (
    <div className="flex gap-2">
      {PENDING_ACTIONS.map(({ key, label, Icon, reason }) => (
        <Button key={key} disabled title={reason}>
          <Icon aria-hidden className="mr-2 h-4 w-4" />
          {label}
        </Button>
      ))}
    </div>
  );
}
