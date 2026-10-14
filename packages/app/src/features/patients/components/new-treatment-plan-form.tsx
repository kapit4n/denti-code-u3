/**
 * Proposing a treatment plan from the patient's profile.
 *
 * A small controlled form rather than React Hook Form, matching the two inline
 * write forms it sits beside — the odontogram's finding form and the visit's
 * treatment recorder. Those are the closest siblings (a section grows one form,
 * not a page), and a plan's shape is close to the visit recorder's: a treatment
 * picker, an optional FDI tooth, an optional note. What it adds is the part a
 * plan is *for* — several lines at once and a price per line.
 *
 * **Nothing is written optimistically**, and the section refetches the plans list
 * on success; this form's only job is to turn typed lines into the body the
 * boundary schema accepts. A line with nothing typed into it is dropped rather
 * than sent as an empty item, and a price the box cannot parse blocks the submit
 * instead of being silently thrown away — an unpriceable line is a typo, not an
 * intent.
 */

import { useState } from 'react';
import type { TreatmentCatalogueItem } from '@denti-code-u3/domain';

import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denti-code-u3/ui';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';

import { useTreatments } from '../../treatments/queries/catalogue-query.js';
import { parseMajorUnitsToMinor } from '../../visits/charge-presentation.js';
import { describeTreatmentPlanFailure } from '../describe-treatment-plan-failure.js';
import {
  useCreatePatientTreatmentPlan,
  type TreatmentPlanDraftItem,
} from '../mutations/use-create-patient-treatment-plan.js';

interface DraftRow {
  readonly key: number;
  readonly treatmentId: string;
  readonly tooth: string;
  readonly quantity: string;
  readonly price: string;
  readonly notes: string;
}

export interface NewTreatmentPlanFormProps {
  readonly patientId: string;
  /** Called after the server has stored the plan. */
  readonly onCreated: () => void;
  readonly onCancel: () => void;
}

function blankRow(key: number): DraftRow {
  return { key, treatmentId: '', tooth: '', quantity: '', price: '', notes: '' };
}

function hasContent(row: DraftRow): boolean {
  return (
    row.treatmentId.length > 0 ||
    row.tooth.trim().length > 0 ||
    row.quantity.trim().length > 0 ||
    row.price.trim().length > 0 ||
    row.notes.trim().length > 0
  );
}

/**
 * The quantity the line asks for, or `undefined` while the box is blank (the
 * server's default of one). A blank box is not an error; a box that is not a whole
 * positive count is, and the caller blocks the submit for it.
 */
function parseQuantity(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function quantityIsValid(row: DraftRow): boolean {
  return row.quantity.trim().length === 0 || parseQuantity(row.quantity) !== undefined;
}

function priceIsValid(row: DraftRow): boolean {
  const trimmed = row.price.trim();
  return trimmed.length === 0 || parseMajorUnitsToMinor(trimmed) !== undefined;
}

function toDraftItem(row: DraftRow): TreatmentPlanDraftItem {
  const quantity = parseQuantity(row.quantity);
  const price = row.price.trim().length > 0 ? parseMajorUnitsToMinor(row.price) : undefined;
  const tooth = row.tooth.trim();
  const notes = row.notes.trim();

  return {
    ...(row.treatmentId.length > 0 ? { treatmentId: row.treatmentId } : {}),
    ...(tooth.length > 0 ? { tooth } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(price !== undefined ? { estimatedPriceMinor: price } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function treatmentLabel(treatment: TreatmentCatalogueItem): string {
  return treatment.code ? `${treatment.code} · ${treatment.name}` : treatment.name;
}

export function NewTreatmentPlanForm({
  patientId,
  onCreated,
  onCancel,
}: NewTreatmentPlanFormProps) {
  const createPlan = useCreatePatientTreatmentPlan();
  const catalogueQuery = useTreatments();
  const catalogue = catalogueQuery.data?.items ?? [];

  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<readonly DraftRow[]>([blankRow(1)]);
  const [nextKey, setNextKey] = useState(2);

  const keptRows = rows.filter(hasContent);
  const rowsAreValid = keptRows.every((row) => quantityIsValid(row) && priceIsValid(row));
  const canSubmit = keptRows.length > 0 && rowsAreValid && !createPlan.isPending;

  const failure = describeTreatmentPlanFailure(
    createPlan.error,
    'The plan could not be saved. Try again.',
  );

  function updateRow(key: number, patch: Partial<Omit<DraftRow, 'key'>>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, blankRow(nextKey)]);
    setNextKey((key) => key + 1);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <form
      className="mt-4 space-y-4 rounded-lg border p-3"
      data-testid="new-treatment-plan-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) {
          return;
        }
        const composedTitle = title.trim();
        createPlan.mutate(
          {
            patientId,
            ...(composedTitle.length > 0 ? { title: composedTitle } : {}),
            items: keptRows.map(toDraftItem),
          },
          { onSuccess: onCreated },
        );
      }}
    >
      {failure ? (
        <div
          role="alert"
          data-testid="new-plan-error"
          className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{failure}</span>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="new-plan-title">Title (optional)</Label>
        <input
          id="new-plan-title"
          data-testid="new-plan-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={createPlan.isPending}
          className="w-full rounded-md border bg-background p-2 text-sm"
          placeholder="e.g. Restorative plan"
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Items</p>

        {rows.map((row) => (
          <div
            key={row.key}
            data-testid="new-plan-item-row"
            className="space-y-2 rounded-md border bg-muted/30 p-2"
          >
            <div className="space-y-1">
              <Label htmlFor={`new-plan-treatment-${row.key}`}>Treatment (optional)</Label>
              <Select
                value={row.treatmentId}
                onValueChange={(value) => updateRow(row.key, { treatmentId: value })}
                disabled={createPlan.isPending}
              >
                <SelectTrigger
                  id={`new-plan-treatment-${row.key}`}
                  data-testid="new-plan-treatment"
                >
                  <SelectValue placeholder="Choose a treatment" />
                </SelectTrigger>
                <SelectContent>
                  {catalogue.map((treatment) => (
                    <SelectItem key={treatment.id} value={treatment.id}>
                      {treatmentLabel(treatment)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="space-y-1">
                <Label htmlFor={`new-plan-tooth-${row.key}`}>Tooth</Label>
                <input
                  id={`new-plan-tooth-${row.key}`}
                  data-testid="new-plan-tooth"
                  value={row.tooth}
                  onChange={(event) => updateRow(row.key, { tooth: event.target.value })}
                  maxLength={2}
                  inputMode="numeric"
                  disabled={createPlan.isPending}
                  className="w-20 rounded-md border bg-background p-2 text-sm"
                  placeholder="36"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`new-plan-quantity-${row.key}`}>Qty</Label>
                <input
                  id={`new-plan-quantity-${row.key}`}
                  data-testid="new-plan-quantity"
                  value={row.quantity}
                  onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                  inputMode="numeric"
                  disabled={createPlan.isPending}
                  className="w-20 rounded-md border bg-background p-2 text-sm"
                  placeholder="1"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`new-plan-price-${row.key}`}>Price</Label>
                <input
                  id={`new-plan-price-${row.key}`}
                  data-testid="new-plan-price"
                  value={row.price}
                  onChange={(event) => updateRow(row.key, { price: event.target.value })}
                  inputMode="decimal"
                  disabled={createPlan.isPending}
                  className="w-28 rounded-md border bg-background p-2 text-sm"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`new-plan-notes-${row.key}`}>Note (optional)</Label>
              <input
                id={`new-plan-notes-${row.key}`}
                data-testid="new-plan-notes"
                value={row.notes}
                onChange={(event) => updateRow(row.key, { notes: event.target.value })}
                disabled={createPlan.isPending}
                className="w-full rounded-md border bg-background p-2 text-sm"
              />
            </div>

            {rows.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(row.key)}
                disabled={createPlan.isPending}
                data-testid="new-plan-remove-item"
              >
                <Trash2 aria-hidden className="size-4" />
                Remove item
              </Button>
            ) : null}
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={createPlan.isPending}
          data-testid="new-plan-add-item"
        >
          <Plus aria-hidden className="size-4" />
          Add item
        </Button>

        {!rowsAreValid ? (
          <p className="text-xs text-destructive" role="status">
            Check the quantity and price — a quantity is a whole number from 1, and a price has at
            most two decimals.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit} data-testid="new-plan-submit">
          {createPlan.isPending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Saving
            </>
          ) : (
            'Save plan'
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={createPlan.isPending}
          data-testid="new-plan-cancel"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
