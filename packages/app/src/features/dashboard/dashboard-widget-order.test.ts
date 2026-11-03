import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  moveDashboardWidget,
  parseDashboardWidgetOrder,
} from './dashboard-widget-order.js';

describe('parseDashboardWidgetOrder', () => {
  it('falls back to the default order when nothing is stored', () => {
    expect(parseDashboardWidgetOrder(null)).toEqual([...DASHBOARD_WIDGET_IDS]);
  });

  it('keeps a complete, unique order the user chose', () => {
    const stored = ['recent-patients', 'today-appointments', 'upcoming-visits', 'calendar-preview'];

    expect(parseDashboardWidgetOrder(JSON.stringify(stored))).toEqual(stored);
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a non-array value', JSON.stringify({ order: DASHBOARD_WIDGET_IDS })],
    ['a missing widget', JSON.stringify(DASHBOARD_WIDGET_IDS.slice(0, 3))],
    ['an unknown widget', JSON.stringify([...DASHBOARD_WIDGET_IDS.slice(0, 3), 'unknown'])],
    [
      'a duplicate widget',
      JSON.stringify([
        'today-appointments',
        'today-appointments',
        'upcoming-visits',
        'recent-patients',
      ]),
    ],
  ])('falls back to the default order for %s', (_label, raw) => {
    expect(parseDashboardWidgetOrder(raw)).toEqual([...DEFAULT_DASHBOARD_WIDGET_ORDER]);
  });
});

describe('moveDashboardWidget', () => {
  it('moves a widget up and down one place', () => {
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'calendar-preview', 'up')).toEqual([
      'calendar-preview',
      'today-appointments',
      'upcoming-visits',
      'recent-patients',
    ]);
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'today-appointments', 'down')).toEqual([
      'calendar-preview',
      'today-appointments',
      'upcoming-visits',
      'recent-patients',
    ]);
  });

  it('does nothing at the edges or for an unknown widget', () => {
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'today-appointments', 'up')).toEqual([
      ...DASHBOARD_WIDGET_IDS,
    ]);
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'recent-patients', 'down')).toEqual([
      ...DASHBOARD_WIDGET_IDS,
    ]);
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'unknown' as never, 'up')).toEqual([
      ...DASHBOARD_WIDGET_IDS,
    ]);
  });

  it('returns a new array, so React sees a state change', () => {
    expect(moveDashboardWidget(DASHBOARD_WIDGET_IDS, 'today-appointments', 'up')).not.toBe(
      DASHBOARD_WIDGET_IDS,
    );
  });
});
