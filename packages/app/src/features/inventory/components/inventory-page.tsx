/**
 * The clinic's consumable stock.
 *
 * One page with three jobs, each represented by one card: see what is low, see
 * every item, and move stock. The low-stock card is not a second source of truth
 * — it filters the same list the catalogue draws, using the domain's
 * `isLowStock`, so a row cannot be "low" in one card and "fine" in the other.
 *
 * The movement form is item-scoped and the history follows the selected item.
 * Nothing is optimistic: the new level and the movement both come back from the
 * server, and the list is refetched rather than patched. An outflow the clinic
 * cannot cover is refused with the server's sentence, which is the point of
 * recording usage at all.
 *
 * Costs are entered the way a person writes them (major units) and converted once,
 * here, to the integer minor units that go over the wire.
 */

import { useState, type FormEvent } from 'react';
import {
  formatMinorUnits,
  isLowStock,
  isStockOutflow,
  type StockMovementType,
} from '@denti-code-u3/domain';
import type { CreateInventoryItemInput } from '@denti-code-u3/validation';
import { createInventoryItemSchema, recordStockMovementSchema } from '@denti-code-u3/validation';
import { AlertCircle, Loader2, Plus, Warehouse } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@denti-code-u3/ui';

import { useClinicSettings } from '../../clinic/queries/clinic-settings-query.js';
import { formatClinicDayTime, READING_THE_CLINIC_CLOCK } from '../../clinic/format-clinic-time.js';
import { parseMajorUnitsToMinor } from '../../visits/charge-presentation.js';
import { describeAddItemFailure, describeMovementFailure } from '../describe-inventory-failure.js';
import { useAddInventoryItem } from '../mutations/use-add-inventory-item.js';
import { useRecordStockMovement } from '../mutations/use-record-stock-movement.js';
import { useInventory, useStockMovements } from '../queries/inventory-query.js';

type FieldErrors = Readonly<Record<string, string>>;

const MOVEMENT_LABELS: Readonly<Record<StockMovementType, string>> = {
  PURCHASE: 'Purchase',
  USAGE: 'Usage',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
  EXPIRED: 'Expired',
};

const MOVEMENT_OPTIONS = (
  Object.entries(MOVEMENT_LABELS) as readonly [StockMovementType, string][]
).map(([value, label]) => ({ value, label }));

function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

export function InventoryPage() {
  const inventoryQuery = useInventory();
  const { data: clinic } = useClinicSettings();

  const addItem = useAddInventoryItem();
  const [selectedItemId, setSelectedItemId] = useState('');
  const recordMovement = useRecordStockMovement(selectedItemId);
  const movementsQuery = useStockMovements(selectedItemId || undefined);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [costMajor, setCostMajor] = useState('');
  const [itemErrors, setItemErrors] = useState<FieldErrors>({});

  const [movementType, setMovementType] = useState<StockMovementType | ''>('');
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [movementErrors, setMovementErrors] = useState<FieldErrors>({});

  const items = inventoryQuery.data?.items ?? [];
  const lowStock = items.filter(isLowStock);
  const selectedItem = items.find((item) => item.id === selectedItemId);

  const addFailure = describeAddItemFailure(
    addItem.error,
    'The inventory item could not be added.',
  );
  const movementFailure = describeMovementFailure(
    recordMovement.error,
    'The stock movement could not be recorded.',
  );

  const handleAddItem = (event: FormEvent) => {
    event.preventDefault();

    if (costMajor.trim() && parseMajorUnitsToMinor(costMajor.trim()) === undefined) {
      setItemErrors({ costMinor: 'Enter a cost like 45.00' });
      return;
    }

    const costMinor = costMajor.trim() ? parseMajorUnitsToMinor(costMajor.trim()) : undefined;

    const input: CreateInventoryItemInput = {
      name: name.trim(),
      sku: sku.trim() || null,
      description: description.trim() || null,
      ...(unit.trim() ? { unit: unit.trim() } : {}),
      ...(openingStock.trim() ? { openingStock: Number(openingStock.trim()) } : {}),
      ...(minStock.trim() ? { minStock: Number(minStock.trim()) } : {}),
      ...(costMinor !== undefined ? { costMinor } : {}),
    };

    const parsed = createInventoryItemSchema.safeParse(input);
    if (!parsed.success) {
      setItemErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setItemErrors({});

    addItem.mutate(parsed.data, {
      onSuccess: (item) => {
        setName('');
        setSku('');
        setDescription('');
        setUnit('');
        setOpeningStock('');
        setMinStock('');
        setCostMajor('');
        setSelectedItemId(item.id);
      },
    });
  };

  const handleMovement = (event: FormEvent) => {
    event.preventDefault();

    const parsed = recordStockMovementSchema.safeParse({
      ...(movementType ? { type: movementType } : {}),
      quantity: quantity.trim() ? Number(quantity.trim()) : undefined,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    if (!parsed.success) {
      setMovementErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setMovementErrors({});

    if (!selectedItemId) {
      setMovementErrors({ itemId: 'Choose the item that moved.' });
      return;
    }

    recordMovement.mutate(parsed.data, {
      onSuccess: () => {
        setQuantity('');
        setReference('');
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
        <p className="text-muted-foreground">
          Consumables, their stock levels and the movements that change them
        </p>
      </header>

      <Card data-testid="inventory-low-stock">
        <CardHeader>
          <CardTitle>Low stock</CardTitle>
          <CardDescription>
            {lowStock.length > 0
              ? `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} at or below the minimum`
              : 'Everything is above its minimum'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inventoryQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading the stock…</p>
          ) : inventoryQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              The inventory could not be loaded.
            </p>
          ) : lowStock.length > 0 ? (
            <ul className="space-y-2">
              {lowStock.map((item) => (
                <li
                  key={item.id}
                  data-testid="low-stock-item"
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{item.name}</span>
                    {item.sku ? (
                      <span className="ml-2 text-xs text-muted-foreground">{item.sku}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right font-medium text-amber-800">
                    {item.stock} {item.unit} of {item.minStock}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {items.length > 0
                ? 'Every item has more than its minimum on the shelf.'
                : 'No items in the inventory yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add an item</CardTitle>
            <CardDescription>
              Opening stock is recorded as an adjustment on the item&rsquo;s ledger.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={handleAddItem} noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="inventory-name">Name</Label>
                  <input
                    id="inventory-name"
                    data-testid="inventory-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={addItem.isPending}
                    maxLength={200}
                    placeholder="e.g. Composite resin A2"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.name ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.name}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inventory-sku">SKU (optional)</Label>
                  <input
                    id="inventory-sku"
                    data-testid="inventory-sku"
                    value={sku}
                    onChange={(event) => setSku(event.target.value)}
                    disabled={addItem.isPending}
                    maxLength={50}
                    placeholder="e.g. COMP-A2"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.sku ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.sku}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inventory-unit">Unit (optional)</Label>
                  <input
                    id="inventory-unit"
                    data-testid="inventory-unit"
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                    disabled={addItem.isPending}
                    maxLength={50}
                    placeholder="unit"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.unit ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.unit}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inventory-opening-stock">Opening stock (optional)</Label>
                  <input
                    id="inventory-opening-stock"
                    data-testid="inventory-opening-stock"
                    value={openingStock}
                    onChange={(event) => setOpeningStock(event.target.value)}
                    disabled={addItem.isPending}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.openingStock ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.openingStock}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inventory-min-stock">Minimum stock (optional)</Label>
                  <input
                    id="inventory-min-stock"
                    data-testid="inventory-min-stock"
                    value={minStock}
                    onChange={(event) => setMinStock(event.target.value)}
                    disabled={addItem.isPending}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder="0"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.minStock ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.minStock}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inventory-cost">Unit cost (optional)</Label>
                  <input
                    id="inventory-cost"
                    data-testid="inventory-cost"
                    value={costMajor}
                    onChange={(event) => setCostMajor(event.target.value)}
                    disabled={addItem.isPending}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="e.g. 45.00"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.costMinor ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.costMinor}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="inventory-description">Description (optional)</Label>
                  <textarea
                    id="inventory-description"
                    data-testid="inventory-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={addItem.isPending}
                    rows={2}
                    maxLength={2_000}
                    placeholder="What the item is used for"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                  />
                  {itemErrors.description ? (
                    <p role="alert" className="text-xs text-destructive">
                      {itemErrors.description}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" data-testid="add-inventory-item" disabled={addItem.isPending}>
                  <Plus aria-hidden className="mr-2 h-4 w-4" />
                  Add item
                </Button>
                {addItem.isPending ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                    Saving…
                  </p>
                ) : null}
              </div>
            </form>

            {addFailure ? (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{addFailure}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="inventory-catalogue">
          <CardHeader>
            <CardTitle>Stock</CardTitle>
            <CardDescription>
              {items.length > 0
                ? `${items.length} item${items.length === 1 ? '' : 's'} in the inventory`
                : 'What this clinic keeps on its shelves'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {inventoryQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading the inventory…</p>
            ) : inventoryQuery.error ? (
              <p role="alert" className="text-sm text-destructive">
                The inventory could not be loaded.
              </p>
            ) : items.length > 0 ? (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    data-testid="inventory-item"
                    className="rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-medium">{item.name}</span>
                        {item.sku ? (
                          <span className="ml-2 text-xs text-muted-foreground">{item.sku}</span>
                        ) : null}
                        {item.description ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right">
                        <span data-testid="inventory-item-stock" className="font-medium">
                          {item.stock} {item.unit}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          min {item.minStock} · {formatMinorUnits(item.costMinor)} each
                        </span>
                      </span>
                    </div>
                    {isLowStock(item) ? (
                      <span
                        data-testid="low-stock-badge"
                        className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                      >
                        <Warehouse aria-hidden className="size-3" />
                        Low stock
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p data-testid="inventory-empty" className="text-sm text-muted-foreground">
                No items in the inventory yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="inventory-movements">
        <CardHeader>
          <CardTitle>Record a movement</CardTitle>
          <CardDescription>
            Usage and expiry take stock out; purchases, returns and adjustments put it in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleMovement} noValidate>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="movement-item">Item</Label>
                <select
                  id="movement-item"
                  data-testid="movement-item"
                  value={selectedItemId}
                  onChange={(event) => setSelectedItemId(event.target.value)}
                  disabled={recordMovement.isPending}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                >
                  <option value="">Choose an item</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {movementErrors.itemId ? (
                  <p role="alert" className="text-xs text-destructive">
                    {movementErrors.itemId}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="movement-type">Type</Label>
                <select
                  id="movement-type"
                  data-testid="movement-type"
                  value={movementType}
                  onChange={(event) =>
                    setMovementType(event.target.value as StockMovementType | '')
                  }
                  disabled={recordMovement.isPending}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                >
                  <option value="">Choose a type</option>
                  {MOVEMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {movementErrors.type ? (
                  <p role="alert" className="text-xs text-destructive">
                    {movementErrors.type}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="movement-quantity">Quantity</Label>
                <input
                  id="movement-quantity"
                  data-testid="movement-quantity"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={recordMovement.isPending}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="1"
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {movementErrors.quantity ? (
                  <p role="alert" className="text-xs text-destructive">
                    {movementErrors.quantity}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="movement-reference">Reference (optional)</Label>
                <input
                  id="movement-reference"
                  data-testid="movement-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  disabled={recordMovement.isPending}
                  maxLength={200}
                  placeholder="e.g. Visit 42"
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {movementErrors.reference ? (
                  <p role="alert" className="text-xs text-destructive">
                    {movementErrors.reference}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                data-testid="record-movement"
                disabled={recordMovement.isPending || items.length === 0}
              >
                <Plus aria-hidden className="mr-2 h-4 w-4" />
                Record movement
              </Button>
              {recordMovement.isPending ? (
                <p className="text-sm text-muted-foreground" role="status">
                  <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                  Saving…
                </p>
              ) : null}
            </div>
          </form>

          {movementFailure ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{movementFailure}</span>
            </div>
          ) : null}

          {selectedItem ? (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-medium">
                {selectedItem.name} movements
                <span className="ml-2 font-normal text-muted-foreground">
                  {selectedItem.stock} {selectedItem.unit} in stock
                </span>
              </h3>
              {movementsQuery.isPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading the movements…</p>
              ) : movementsQuery.error ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  The movements could not be loaded.
                </p>
              ) : (movementsQuery.data?.items.length ?? 0) > 0 ? (
                <ul className="mt-2 space-y-2">
                  {movementsQuery.data?.items.map((movement) => (
                    <li
                      key={movement.id}
                      data-testid="stock-movement"
                      className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{MOVEMENT_LABELS[movement.type]}</span>
                        {movement.reference ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {movement.reference}
                          </span>
                        ) : null}
                        {clinic?.timeZone ? (
                          <span className="block text-xs text-muted-foreground">
                            {formatClinicDayTime(movement.performedAt, clinic.timeZone)}{' '}
                            {READING_THE_CLINIC_CLOCK}
                          </span>
                        ) : null}
                      </span>
                      <span
                        data-testid="stock-movement-quantity"
                        className="shrink-0 font-medium tabular-nums"
                      >
                        {isStockOutflow(movement.type) ? '−' : '+'}
                        {movement.quantity} {selectedItem.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No movements recorded yet.</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
