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

import { useTranslation, type TranslationKey } from '../../../i18n/index.js';

interface ActionTile {
  readonly key: string;
  readonly labelKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly Icon: LucideIcon;
  readonly to: string;
  readonly chip: string;
}

const tiles: readonly ActionTile[] = [
  {
    key: 'agenda',
    labelKey: 'dashboard.quickActionsPanel.agenda.label',
    descriptionKey: 'dashboard.quickActionsPanel.agenda.description',
    Icon: CalendarDays,
    to: '/agenda',
    chip: 'bg-metric-blue-soft text-metric-blue',
  },
  {
    key: 'patients',
    labelKey: 'dashboard.quickActionsPanel.patients.label',
    descriptionKey: 'dashboard.quickActionsPanel.patients.description',
    Icon: Users,
    to: '/patients',
    chip: 'bg-metric-green-soft text-metric-green',
  },
  {
    key: 'treatments',
    labelKey: 'dashboard.quickActionsPanel.treatments.label',
    descriptionKey: 'dashboard.quickActionsPanel.treatments.description',
    Icon: Pill,
    to: '/treatments',
    chip: 'bg-metric-violet-soft text-metric-violet',
  },
];

export function QuickActionsPanel() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.quickActionsPanel.title')}</CardTitle>
        <CardDescription>{t('dashboard.quickActionsPanel.description')}</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3 sm:grid-cols-3">
        {tiles.map(({ key, labelKey, descriptionKey, Icon, to, chip }) => (
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
              <span className="block truncate text-sm font-medium">{t(labelKey)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(descriptionKey)}
              </span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
