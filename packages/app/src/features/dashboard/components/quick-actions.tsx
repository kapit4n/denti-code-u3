import { Button } from '@denti-code-u3/ui';
import { CalendarPlus, UserPlus } from 'lucide-react';

export function QuickActions() {
  return (
    <div className="flex gap-2">
      <Button>
        <CalendarPlus className="mr-2 h-4 w-4" />
        New Visit
      </Button>
      <Button variant="outline">
        <UserPlus className="mr-2 h-4 w-4" />
        New Patient
      </Button>
    </div>
  );
}
