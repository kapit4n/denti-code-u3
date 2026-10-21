/**
 * The dashboard's "where to next" panel.
 *
 * These are secondary shortcuts, not the primary calls to action: booking and
 * registering a patient live in the header, one press away from the greeting.
 * Every tile here points at a route that exists, which is the rule the primary
 * actions already follow — a tile that looks live but goes nowhere is worse than
 * one that is not drawn, so nothing speculative is listed. In particular there is
 * no "Add treatment", "Add payment" or "View reports": none of those has a screen
 * a dashboard tile could honestly open yet.
 */

import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@denti-code-u3/ui';
import { CalendarDays, Pill, Users, type LucideIcon } from 'lucide-react';

interface ActionTile {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly Icon: LucideIcon;
  readonly to: string;
  readonly chip: string;
}

const tiles: readonly ActionTile[] = [
  {
    key: 'agenda',
    label: 'Open agenda',
    description: 'See and book the day',
    Icon: CalendarDays,
    to: '/agenda',
    chip: 'bg-metric-blue-soft text-metric-blue',
  },
  {
    key: 'patients',
    label: 'Patient records',
    description: 'Search the whole clinic',
    Icon: Users,
    to: '/patients',
    chip: 'bg-metric-green-soft text-metric-green',
  },
  {
    key: 'treatments',
    label: 'Treatment catalogue',
    description: 'Procedures and prices',
    Icon: Pill,
    to: '/treatments',
    chip: 'bg-metric-violet-soft text-metric-violet',
  },
];

export function QuickActionsPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Jump to the screens you use most</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-3">
        {tiles.map(({ key, label, description, Icon, to, chip }) => (
          <Link
            key={key}
            to={to}
            className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <span
              className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', chip)}
            >
              <Icon aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{description}</span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
