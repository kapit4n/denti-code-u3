/**
 * The patient's tooth map, drawn as the two arches clinicians expect.
 *
 * A presentation-only component: it owns no hooks and knows no endpoints. It
 * receives the charted entries and the selection from its parent, so the chart in
 * the profile and the chart in a test render the same cells.
 *
 * The layout is FDI, patient-facing — the upper arch reads left-to-right 18…11
 * then 21…28 (the patient's right teeth to left teeth), the lower arch reads
 * 48…41 then 31…38, and the primary numbers 85…51 arch above. A tooth the chart
 * has an entry for carries that entry's condition; an uncharted tooth renders
 * neutral and is just as selectable, because charting starts with a tooth that
 * has no state yet.
 *
 * The color of a condition is a static class name, never a string built at
 * runtime: Tailwind must see the literal to emit the CSS for it, so the map below
 * is the one place a condition's appearance is decided.
 */

import type { OdontogramCondition, PatientOdontogramEntry } from '@denti-code-u3/domain';

/** FDI upper-right then upper-left, patient-facing rows. */
const PERMANENT_UPPER = [
  '18',
  '17',
  '16',
  '15',
  '14',
  '13',
  '12',
  '11',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
];
/** FDI lower-right then lower-left. */
const PERMANENT_LOWER = [
  '48',
  '47',
  '46',
  '45',
  '44',
  '43',
  '42',
  '41',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
];
const PRIMARY_UPPER = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'];
const PRIMARY_LOWER = ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'];

const CONDITION_CELL: Record<OdontogramCondition, string> = {
  HEALTHY: 'border-border text-muted-foreground',
  CARIES: 'border-destructive bg-destructive/15 text-destructive',
  FILLED: 'border-primary/60 bg-primary/15 text-primary',
  MISSING: 'border-border bg-muted text-muted-foreground line-through',
  CROWN: 'border-amber-500/60 bg-amber-500/15 text-amber-700',
  IMPLANT: 'border-violet-500/60 bg-violet-500/15 text-violet-700',
  ROOT_CANAL: 'border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-700',
  EXTRACTION_INDICATED: 'border-rose-500/60 bg-rose-500/10 text-rose-700',
  EXTRACTED: 'border-border bg-muted text-muted-foreground line-through',
  SEALANT: 'border-teal-500/60 bg-teal-500/15 text-teal-700',
  VENEER: 'border-sky-500/60 bg-sky-500/15 text-sky-700',
  FRACTURE: 'border-orange-500/60 bg-orange-500/15 text-orange-700',
  MOBILITY: 'border-red-500 bg-red-500/10 text-red-700',
  PROSTHESIS: 'border-indigo-500/60 bg-indigo-500/15 text-indigo-700',
};

interface OdontogramChartProps {
  readonly entries: readonly PatientOdontogramEntry[];
  /** The tooth chosen for the form, or `null` while none is chosen. */
  readonly selectedTooth: string | null;
  readonly onSelectTooth: (tooth: string) => void;
}

export function OdontogramChart({ entries, selectedTooth, onSelectTooth }: OdontogramChartProps) {
  const entryByTooth = new Map(entries.map((entry) => [entry.tooth, entry]));

  return (
    <div className="space-y-4" data-testid="odontogram-chart">
      <ToothRow
        title="Primary upper"
        teeth={PRIMARY_UPPER}
        entryByTooth={entryByTooth}
        selectedTooth={selectedTooth}
        onSelectTooth={onSelectTooth}
      />
      <ToothRow
        title="Primary lower"
        teeth={PRIMARY_LOWER}
        entryByTooth={entryByTooth}
        selectedTooth={selectedTooth}
        onSelectTooth={onSelectTooth}
      />
      <ToothRow
        title="Upper permanent"
        teeth={PERMANENT_UPPER}
        entryByTooth={entryByTooth}
        selectedTooth={selectedTooth}
        onSelectTooth={onSelectTooth}
      />
      <ToothRow
        title="Lower permanent"
        teeth={PERMANENT_LOWER}
        entryByTooth={entryByTooth}
        selectedTooth={selectedTooth}
        onSelectTooth={onSelectTooth}
      />
    </div>
  );
}

interface ToothRowProps {
  readonly teeth: readonly string[];
  readonly title?: string;
  readonly entryByTooth: ReadonlyMap<string, PatientOdontogramEntry>;
  readonly selectedTooth: string | null;
  readonly onSelectTooth: (tooth: string) => void;
}

function ToothRow({ teeth, title, entryByTooth, selectedTooth, onSelectTooth }: ToothRowProps) {
  return (
    <div className="space-y-2">
      {title ? (
        <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      ) : null}
      {/* A full arch is drawn as two halves with a gap where the midline belongs;
          a primary arch has no permanent midline to show and reads as one row. */}
      {teeth.length > 8 ? (
        <div className="flex items-center justify-center gap-4">
          <ToothCells
            teeth={teeth.slice(0, 8)}
            entryByTooth={entryByTooth}
            selectedTooth={selectedTooth}
            onSelectTooth={onSelectTooth}
          />
          <ToothCells
            teeth={teeth.slice(8)}
            entryByTooth={entryByTooth}
            selectedTooth={selectedTooth}
            onSelectTooth={onSelectTooth}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <ToothCells
            teeth={teeth}
            entryByTooth={entryByTooth}
            selectedTooth={selectedTooth}
            onSelectTooth={onSelectTooth}
          />
        </div>
      )}
    </div>
  );
}

function ToothCells({
  teeth,
  entryByTooth,
  selectedTooth,
  onSelectTooth,
}: {
  readonly teeth: readonly string[];
  readonly entryByTooth: ReadonlyMap<string, PatientOdontogramEntry>;
  readonly selectedTooth: string | null;
  readonly onSelectTooth: (tooth: string) => void;
}) {
  return (
    <>
      {teeth.map((tooth) => {
        const entry = entryByTooth.get(tooth);
        const isSelected = selectedTooth === tooth;
        // The read model spells `condition` as a string the database's own enum
        // guard keeps truthful, so the map's key is asserted where the row meets
        // the cell (the same assertion the write path's typing makes).
        const cellClass = entry
          ? CONDITION_CELL[entry.condition as OdontogramCondition]
          : undefined;

        return (
          <button
            key={tooth}
            type="button"
            data-testid={`odontogram-tooth-${tooth}`}
            data-condition={entry?.condition ?? 'UNCHARTED'}
            aria-pressed={isSelected}
            onClick={() => onSelectTooth(tooth)}
            className={`h-11 w-9 rounded-md border text-xs font-medium transition-colors ${
              cellClass ?? CONDITION_CELL.HEALTHY
            } ${isSelected ? 'ring-2 ring-ring ring-offset-1' : ''}`}
          >
            {tooth}
          </button>
        );
      })}
    </>
  );
}
