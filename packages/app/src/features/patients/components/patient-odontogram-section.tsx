/**
 * The patient's odontogram: the tooth map and the door to chart it (Milestone 7).
 *
 * Mounted on the profile while it is rendered, which is what keeps its one
 * request an answer to something on screen. It owns its own hooks rather than
 * taking them as props, because this is a feature with a chart, a draft and a
 * mutation of its own — the same ownership the notes section has on the visit
 * workspace.
 *
 * The form is only enabled when a tooth is chosen on the chart, because the tooth
 * is the map's unit: a chart that fell back to a text field would be a chart that
 * had no map to click. **Nothing is written optimistically, and a refusal keeps
 * the draft** — the clinician's sentence is not discarded because the server
 * disagreed with it, and the refusal's message explains what to fix.
 *
 * The condition and surface options come from the domain's own constants rather
 * than a second list, so the dropdown can never offer a condition the write path
 * cannot store.
 */

import { useState, type FormEvent } from 'react';
import { ODONTOGRAM_CONDITIONS, ODONTOGRAM_SURFACES } from '@denti-code-u3/domain';
import { AlertCircle, Loader2 } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@denti-code-u3/ui';
import { formatClinicDayTime, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { describeOdontogramFailure } from '../describe-odontogram-failure.js';
import { useRecordOdontogramEntry } from '../mutations/use-record-odontogram-entry.js';
import { usePatientOdontogram } from '../hooks/use-patients.js';
import { OdontogramChart } from './odontogram-chart.js';

interface PatientOdontogramSectionProps {
  readonly patientId: string;
  /** Absent while the clinic is still being fetched; the times then wait for it. */
  readonly clinicTimeZone: string | undefined;
}

type ConditionState = (typeof ODONTOGRAM_CONDITIONS)[number];
type SurfaceState = (typeof ODONTOGRAM_SURFACES)[number];

export function PatientOdontogramSection({
  patientId,
  clinicTimeZone,
}: PatientOdontogramSectionProps) {
  const odontogramQuery = usePatientOdontogram(patientId);
  const recordEntry = useRecordOdontogramEntry();
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [condition, setCondition] = useState<ConditionState>(ODONTOGRAM_CONDITIONS[0]);
  const [surfaces, setSurfaces] = useState<readonly SurfaceState[]>([]);
  const [notes, setNotes] = useState('');

  const failure = describeOdontogramFailure(recordEntry.error, 'The tooth could not be charted.');

  const toggleSurface = (surface: SurfaceState) => {
    setSurfaces((current) =>
      current.includes(surface) ? current.filter((s) => s !== surface) : [...current, surface],
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTooth) {
      return;
    }
    recordEntry.mutate(
      {
        patientId,
        tooth: selectedTooth,
        condition,
        surfaces,
        ...(notes.trim() ? { notes } : {}),
      },
      {
        onSuccess: () => {
          setNotes('');
          setSurfaces([]);
        },
      },
    );
  };

  const entries = odontogramQuery.data?.entries ?? [];

  return (
    <Card data-testid="patient-odontogram">
      <CardHeader>
        <CardTitle>Odontogram</CardTitle>
        <CardDescription>The per-tooth clinical map</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {odontogramQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading the chart…</p>
        ) : odontogramQuery.error ? (
          <p className="text-sm text-destructive" role="alert">
            The chart could not be loaded.
          </p>
        ) : (
          <>
            <OdontogramChart
              entries={entries}
              selectedTooth={selectedTooth}
              onSelectTooth={setSelectedTooth}
            />

            <form className="space-y-3" onSubmit={handleSubmit}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="odontogram-condition">Condition</Label>
                  <select
                    id="odontogram-condition"
                    data-testid="odontogram-condition"
                    value={condition}
                    onChange={(event) => setCondition(event.target.value as typeof condition)}
                    disabled={recordEntry.isPending}
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  >
                    {ODONTOGRAM_CONDITIONS.map((option) => (
                      <option key={option} value={option}>
                        {option.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Surfaces</Label>
                  <div className="flex flex-wrap gap-2">
                    {ODONTOGRAM_SURFACES.map((surface) => (
                      <label
                        key={surface}
                        data-testid={`odontogram-surface-${surface}`}
                        className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                      >
                        <input
                          type="checkbox"
                          value={surface}
                          checked={surfaces.includes(surface)}
                          onChange={() => toggleSurface(surface)}
                          disabled={recordEntry.isPending}
                          className="size-3.5 accent-primary"
                        />
                        {surface}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="odontogram-notes">Notes (optional)</Label>
                <textarea
                  id="odontogram-notes"
                  data-testid="odontogram-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  disabled={recordEntry.isPending}
                  rows={2}
                  maxLength={2_000}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  placeholder="e.g. composite patch scheduled"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  data-testid="record-odontogram-entry"
                  disabled={recordEntry.isPending || !selectedTooth}
                >
                  {selectedTooth ? `Chart tooth ${selectedTooth}` : 'Select a tooth to chart'}
                </Button>
                {recordEntry.isPending ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                    Saving…
                  </p>
                ) : null}
              </div>
            </form>

            {entries.length > 0 ? (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
                    data-testid="odontogram-entry"
                  >
                    <span>
                      <span className="font-medium">Tooth {entry.tooth}</span> ·{' '}
                      {entry.condition.replaceAll('_', ' ')}
                      {entry.surfaces.length > 0 ? ` · ${entry.surfaces.join(', ')}` : ''}
                      {entry.notes ? (
                        <span className="text-muted-foreground"> — {entry.notes}</span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground">
                      {clinicTimeZone ? (
                        formatClinicDayTime(entry.recordedAt, clinicTimeZone)
                      ) : (
                        <span className="text-muted-foreground">{READING_THE_CLINIC_CLOCK}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No teeth charted yet.</p>
            )}

            {failure ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{failure}</span>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
