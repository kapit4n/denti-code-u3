import type { AppointmentId } from '@denti-code-u3/types';

import { useTranslation } from '../../../i18n/index.js';
import { formatClinicDayTime } from '../../clinic/format-clinic-time.js';
import { appointmentStatusLabel } from '../appointment-status-presentation.js';
import { useAppointmentProgress } from '../queries/appointment-progress-query.js';

export interface AppointmentProgressTimelineProps {
  readonly appointmentId: AppointmentId;
  readonly timeZone: string;
}

export function AppointmentProgressTimeline({
  appointmentId,
  timeZone,
}: AppointmentProgressTimelineProps) {
  const { locale, t } = useTranslation();
  const progress = useAppointmentProgress(appointmentId);

  return (
    <section className="space-y-2" data-testid="appointment-progress">
      <h3 className="text-sm font-medium">{t('agenda.progress.title')}</h3>

      {progress.isPending ? (
        <p className="text-sm text-muted-foreground">{t('agenda.progress.loading')}</p>
      ) : null}

      {progress.isError ? (
        <p className="text-sm text-destructive">{t('agenda.progress.error')}</p>
      ) : null}

      {progress.data && progress.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('agenda.progress.empty')}</p>
      ) : null}

      {progress.data && progress.data.items.length > 0 ? (
        <ol className="space-y-2">
          {progress.data.items.map((item, index) => (
            <li
              key={`${item.occurredAt}-${item.toStatus}-${index}`}
              className="border-l-2 border-border pl-3 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  {item.fromStatus
                    ? `${appointmentStatusLabel(t, item.fromStatus)} → ${appointmentStatusLabel(t, item.toStatus)}`
                    : appointmentStatusLabel(t, item.toStatus)}
                </span>
                <time dateTime={item.occurredAt} className="text-muted-foreground">
                  {formatClinicDayTime(item.occurredAt, timeZone, locale)}
                </time>
              </div>
              {item.reason ? <p className="mt-1 text-muted-foreground">{item.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
