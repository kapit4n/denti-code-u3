import { useCallback, useEffect, useState } from 'react';

import {
  DASHBOARD_WIDGET_ORDER_STORAGE_KEY,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  moveDashboardWidget,
  parseDashboardWidgetOrder,
  type DashboardWidgetDirection,
  type DashboardWidgetId,
} from '../dashboard-widget-order.js';

function storage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readOrder(): DashboardWidgetId[] {
  const store = storage();
  if (!store) return [...DEFAULT_DASHBOARD_WIDGET_ORDER];

  try {
    return parseDashboardWidgetOrder(store.getItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY));
  } catch {
    return [...DEFAULT_DASHBOARD_WIDGET_ORDER];
  }
}

export function useDashboardWidgetOrder() {
  const [order, setOrder] = useState<DashboardWidgetId[]>(readOrder);

  useEffect(() => {
    const store = storage();
    if (!store) return;

    try {
      store.setItem(DASHBOARD_WIDGET_ORDER_STORAGE_KEY, JSON.stringify(order));
    } catch {
      // A webview that refuses storage still keeps this session's order.
    }
  }, [order]);

  const move = useCallback((id: DashboardWidgetId, direction: DashboardWidgetDirection) => {
    setOrder((current) => moveDashboardWidget(current, id, direction));
  }, []);

  return { order, move };
}
