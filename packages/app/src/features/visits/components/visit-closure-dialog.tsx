/**
 * The question the complete button asks when this patient still has open planned
 * work: which of these lines did the visit finish?
 *
 * **A ticked line is completed and billed; an unticked line stays open.** That is
 * the whole contract, and it is why the dialog is not a confirmation of the visit
 * alone: the plan's open lines are the work the clinician is about to walk away
 * from, and the record should say whether they are done. Leaving them all unticked
 * is a legitimate closure — the plan remains as it was — so the confirm button is
 * never disabled for an empty selection.
 *
 * **The dialog is only opened when there is something to ask.** A visit whose
 * patient has no open planned lines closes with one click, exactly as it did
 * before; this component is not a mandatory step in front of every closure.
 */

import { useState } from 'react';
import type { TreatmentPlanItemSummary, TreatmentPlanSummary } from '@denti-code-u3/domain';
import { AlertCircle, Loader2 } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@denti-code-u3/ui';

import { useTranslation } from '../../../i18n/index.js';

export interface VisitClosurePlanLine {
  readonly plan: TreatmentPlanSummary;
  readonly item: TreatmentPlanItemSummary;
}

export interface VisitClosureSelection {
  readonly planId: string;
  readonly itemId: string;
}

interface VisitClosureDialogProps {
  readonly lines: readonly VisitClosurePlanLine[];
  readonly isPending: boolean;
  readonly failure: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (selection: readonly VisitClosureSelection[]) => void;
}

function lineKey(planId: string, itemId: string): string {
  return `${planId}:${itemId}`;
}

export function VisitClosureDialog({
  lines,
  isPending,
  failure,
  onClose,
  onConfirm,
}: VisitClosureDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(planId: string, itemId: string) {
    setSelected((current) => {
      const next = new Set(current);
      const key = lineKey(planId, itemId);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const selection = lines
    .filter(({ plan, item }) => selected.has(lineKey(plan.id, item.id)))
    .map(({ plan, item }) => ({ planId: plan.id, itemId: item.id }));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent data-testid="visit-closure-dialog">
        <DialogHeader>
          <DialogTitle>{t('visits.closureDialog.title')}</DialogTitle>
          <DialogDescription>{t('visits.closureDialog.description')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isPending) {
              return;
            }
            onConfirm(selection);
          }}
        >
          {failure ? (
            <div
              role="alert"
              data-testid="visit-closure-error"
              className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}

          <ul className="space-y-2">
            {lines.map(({ plan, item }) => {
              const key = lineKey(plan.id, item.id);
              const label =
                item.treatmentName?.trim() ||
                item.treatmentCode ||
                t('visits.treatments.plannedLineFallback');

              return (
                <li key={key}>
                  <label
                    data-testid={`visit-closure-item-${item.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(plan.id, item.id)}
                      disabled={isPending}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {item.tooth ? t('visits.treatments.tooth', { tooth: item.tooth }) : label}
                        {item.tooth ? ` · ${label}` : ''}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {plan.title?.trim() || t('visits.treatments.planFallback')}
                        {' · '}
                        {item.sessions.length > 0
                          ? t('visits.treatments.planInProgress')
                          : t('visits.treatments.planPending')}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground" role="status">
            {selection.length > 0
              ? t('visits.closureDialog.selected', { count: selection.length })
              : t('visits.closureDialog.noneSelected')}
          </p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              {t('visits.closureDialog.cancel')}
            </Button>
            <Button type="submit" disabled={isPending} data-testid="visit-closure-confirm">
              {isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {t('visits.closureDialog.completing')}
                </>
              ) : (
                t('visits.closureDialog.confirm')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
