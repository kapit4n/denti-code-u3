/**
 * One dashboard metric.
 *
 * A reusable primitive rather than a dashboard-specific card: every widget on
 * the dashboard and every panel in a future milestone composes this, so the
 * loading, error and empty states are written once and behave identically
 * everywhere.
 *
 * The three states are deliberately distinct:
 *
 *  - `isLoading` shows a placeholder of the same shape, so the grid does not
 *    jump when data arrives;
 *  - `error` shows the failure instead of silently rendering `0`, because a
 *    metric that failed to load and a metric that is genuinely zero are
 *    different facts and a clinic must not confuse them;
 *  - a `null` value renders as an em dash. The API returns `null` for figures it
 *    genuinely cannot know (today's occupancy with no recorded opening hours),
 *    and inventing a `0%` there would be a confident lie.
 *
 * **The accent is decoration, never information.** It tints the icon chip so a
 * wall of six numbers can be read at a glance, but the value keeps the body text
 * colour: a hue that has to stay legible on white must not also be the only thing
 * distinguishing "appointments" from "completed", and a colour-blind operator
 * would lose exactly the distinction the label already carries.
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@denti-code-u3/ui';
import { useTranslation } from '../../../i18n/index.js';

/** The six accents the dashboard metrics are drawn from. */
export type StatAccent = 'blue' | 'green' | 'amber' | 'violet' | 'rose' | 'slate';

/**
 * Literal class strings, not a computed `bg-metric-${accent}-soft`.
 *
 * Tailwind v4 scans source text for class names; a template literal would leave
 * `bg-metric-green-soft` and its siblings invisible to the compiler and silently
 * drop them from the build. Every class a metric can ask for is spelled out.
 */
const ACCENT_CHIP: Record<StatAccent, string> = {
  blue: 'bg-metric-blue-soft text-metric-blue',
  green: 'bg-metric-green-soft text-metric-green',
  amber: 'bg-metric-amber-soft text-metric-amber',
  violet: 'bg-metric-violet-soft text-metric-violet',
  rose: 'bg-metric-rose-soft text-metric-rose',
  slate: 'bg-metric-slate-soft text-metric-slate',
};

export interface StatCardProps {
  readonly title: string;
  /** A pre-formatted string. Formatting belongs to the caller, not here. */
  readonly value: string | number;
  readonly description?: string;
  readonly icon?: LucideIcon;
  /** Tints the icon chip. Purely visual; defaults to the neutral slate. */
  readonly accent?: StatAccent;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
  /** Rendered in a muted tone when the metric is unknown rather than zero. */
  readonly isUnknown?: boolean;
  readonly className?: string;
  /**
   * Stable test id segment. Defaults to the visible title so existing reports
   * specs keep working; translated dashboards pass an English id instead.
   */
  readonly testId?: string;
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  accent = 'slate',
  isLoading = false,
  error = null,
  isUnknown = false,
  className,
  testId,
}: StatCardProps) {
  const { t } = useTranslation();
  const id = testId ?? title;

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-5 shadow-card transition-shadow hover:shadow-card-hover',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon ? (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              ACCENT_CHIP[accent],
            )}
          >
            <Icon aria-hidden className="h-5 w-5" />
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        {error ? (
          <p className="text-sm text-destructive" data-testid={`stat-card-error-${id}`}>
            {t('common.unavailable')}
          </p>
        ) : isLoading ? (
          <div
            aria-hidden
            className="h-8 w-20 animate-pulse rounded bg-muted"
            data-testid={`stat-card-skeleton-${id}`}
          />
        ) : (
          <p
            className={cn(
              'text-3xl font-bold tracking-tight',
              isUnknown && 'text-muted-foreground',
            )}
            data-testid={`stat-card-value-${id}`}
          >
            {isUnknown ? '—' : value}
          </p>
        )}

        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
