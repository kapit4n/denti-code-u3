import type { ComponentType } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@denti-code-u3/ui';

import { useTranslation, type TranslationKey } from '../../../i18n/index.js';
import type { DashboardWidgetId } from '../dashboard-widget-order.js';
import { useDashboardWidgetOrder } from '../hooks/use-dashboard-widget-order.js';
import { CalendarPreview } from './calendar-preview.js';
import { RecentPatients } from './recent-patients.js';
import { TodayAppointments } from './today-appointments.js';
import { UpcomingVisits } from './upcoming-visits.js';

interface DashboardWidgetDefinition {
  readonly titleKey: TranslationKey;
  readonly Component: ComponentType;
}

const WIDGETS: Record<DashboardWidgetId, DashboardWidgetDefinition> = {
  'today-appointments': {
    titleKey: 'dashboard.todayAppointments.title',
    Component: TodayAppointments,
  },
  'calendar-preview': {
    titleKey: 'dashboard.calendar.title',
    Component: CalendarPreview,
  },
  'upcoming-visits': {
    titleKey: 'dashboard.upcomingVisits.title',
    Component: UpcomingVisits,
  },
  'recent-patients': {
    titleKey: 'dashboard.recentPatients.title',
    Component: RecentPatients,
  },
};

export function DashboardSchedule() {
  const { t } = useTranslation();
  const { order, move } = useDashboardWidgetOrder();

  return (
    <section aria-label={t('dashboard.section.schedule')} className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('dashboard.widgets.title')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('dashboard.widgets.description')}</p>
      </div>

      <div className="flex flex-col gap-6">
        {order.map((id, index) => {
          const widget = WIDGETS[id];
          const title = t(widget.titleKey);
          const Widget = widget.Component;

          return (
            <div
              key={id}
              data-testid="dashboard-widget"
              data-widget-id={id}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={t('dashboard.widgets.moveUp', { widget: title })}
                  title={t('dashboard.widgets.moveUp', { widget: title })}
                  disabled={index === 0}
                  onClick={() => move(id, 'up')}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  aria-label={t('dashboard.widgets.moveDown', { widget: title })}
                  title={t('dashboard.widgets.moveDown', { widget: title })}
                  disabled={index === order.length - 1}
                  onClick={() => move(id, 'down')}
                >
                  <ArrowDown aria-hidden />
                </Button>
              </div>
              <Widget />
            </div>
          );
        })}
      </div>
    </section>
  );
}
