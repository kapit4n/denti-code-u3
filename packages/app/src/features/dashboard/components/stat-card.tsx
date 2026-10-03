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
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@denti-code-u3/ui';

export interface StatCardProps {
  readonly title: string;
  /** A pre-formatted string. Formatting belongs to the caller, not here. */
  readonly value: string | number;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly isLoading?: boolean;
  readonly error?: Error | null;
  /** Rendered in a muted tone when the metric is unknown rather than zero. */
  readonly isUnknown?: boolean;
  readonly className?: string;
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  isLoading = false,
  error = null,
  isUnknown = false,
  className,
}: StatCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {Icon ? <Icon aria-hidden className="h-5 w-5 text-muted-foreground" /> : null}
      </div>

      <div className="mt-2">
        {error ? (
          <p className="text-sm text-destructive">Unavailable</p>
        ) : isLoading ? (
          <div
            aria-hidden
            className="h-8 w-20 animate-pulse rounded bg-muted"
            data-testid={`stat-card-skeleton-${title}`}
          />
        ) : (
          <p
            className={cn('text-2xl font-bold', isUnknown && 'text-muted-foreground')}
            data-testid={`stat-card-value-${title}`}
          >
            {isUnknown ? '—' : value}
          </p>
        )}

        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
