export const DASHBOARD_WIDGET_ORDER_STORAGE_KEY = 'denti-code-dashboard-widget-order';

export const DASHBOARD_WIDGET_IDS = [
  'today-appointments',
  'calendar-preview',
  'upcoming-visits',
  'recent-patients',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export type DashboardWidgetDirection = 'up' | 'down';

export const DEFAULT_DASHBOARD_WIDGET_ORDER: readonly DashboardWidgetId[] = DASHBOARD_WIDGET_IDS;

export function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && (DASHBOARD_WIDGET_IDS as readonly string[]).includes(value);
}

export function parseDashboardWidgetOrder(raw: string | null): DashboardWidgetId[] {
  const fallback = [...DEFAULT_DASHBOARD_WIDGET_ORDER];
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!Array.isArray(parsed) || parsed.length !== DASHBOARD_WIDGET_IDS.length) {
    return fallback;
  }

  const order: DashboardWidgetId[] = [];
  for (const value of parsed) {
    if (!isDashboardWidgetId(value)) return fallback;
    order.push(value);
  }

  return new Set(order).size === order.length ? order : fallback;
}

export function moveDashboardWidget(
  order: readonly DashboardWidgetId[],
  id: DashboardWidgetId,
  direction: DashboardWidgetDirection,
): DashboardWidgetId[] {
  const index = order.indexOf(id);
  if (index === -1) return [...order];

  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= order.length) return [...order];

  const moved = [...order];
  const [widget] = moved.splice(index, 1);
  moved.splice(nextIndex, 0, widget!);
  return moved;
}
