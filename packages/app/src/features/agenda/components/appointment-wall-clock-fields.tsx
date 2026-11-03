import { Input, Label } from '@denti-code-u3/ui';

export interface AppointmentWallClockFieldsProps {
  readonly idPrefix: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly date: string;
  readonly time: string;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly onDateChange: (date: string) => void;
  readonly onTimeChange: (time: string) => void;
}

export function AppointmentWallClockFields({
  idPrefix,
  dateLabel,
  timeLabel,
  date,
  time,
  disabled,
  autoFocus,
  onDateChange,
  onTimeChange,
}: AppointmentWallClockFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-date`}>{dateLabel}</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={date}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-time`}>{timeLabel}</Label>
        <Input
          id={`${idPrefix}-time`}
          type="time"
          value={time}
          disabled={disabled}
          onChange={(event) => onTimeChange(event.target.value)}
        />
      </div>
    </div>
  );
}
