/**
 * The clinic's treatment catalogue, and the door to add to it.
 *
 * This is Milestone 8's admin screen: the procedures the clinic offers, with the
 * codes, durations and prices the workspace's Treatments section picks from. It
 * reads one collection and writes one way — a row appended by `POST /treatments`
 * — so the screen is deliberately a list and a form rather than a table with
 * edit and delete affordances those endpoints do not have. A control that looks
 * live and is not is worse than an absent one (the same rule the agenda's grid
 * was built under).
 *
 * **Nothing appears before the server agrees.** The mutation invalidates the
 * catalogue and the refetch brings the row in carrying its `id`; a treatment
 * listed from the form's own values would be an offer the workspace's picker
 * could pick before the API had accepted it. A refusal keeps the whole draft,
 * as every form in this app does: a sentence about a duplicate code is worth
 * nothing if the code has been cleared from the box.
 *
 * The price is entered the way a person thinks of it — major units, with a
 * decimal point — and converted once, here, to the integer minor units every
 * money value in this system is stored as (`parseMajorUnitsToMinor`, the same
 * parser the charge line uses).
 */

import { useState, type FormEvent } from 'react';
import { formatMinorUnits } from '@denti-code-u3/domain';
import type { CreateTreatmentInput } from '@denti-code-u3/validation';
import { createTreatmentSchema } from '@denti-code-u3/validation';
import { AlertCircle, Loader2, Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@denti-code-u3/ui';
import { useTranslation } from '../../../i18n/index.js';
import { parseMajorUnitsToMinor } from '../../visits/charge-presentation.js';
import { useTreatments } from '../queries/catalogue-query.js';
import { useAddTreatment } from '../mutations/use-add-treatment.js';
import { describeCatalogueFailure } from '../describe-catalogue-failure.js';

/** Every field's own sentence, keyed by the schema's path. */
type FieldErrors = Readonly<Record<string, string>>;

export function TreatmentCatalogue() {
  const { t } = useTranslation();
  const catalogueQuery = useTreatments();
  const addTreatment = useAddTreatment();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [priceMajor, setPriceMajor] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const failure = describeCatalogueFailure(addTreatment.error, t('treatments.add.failure'), {
    notFound: t('treatments.add.notFound'),
    network: t('treatments.add.network'),
  });

  /**
   * What the boxes hold, as the API's own schema reads them.
   *
   * A blank box is `null` (or absent) rather than `''`, because the endpoint
   * refuses `''` for `code` and the domain stores nil for an empty description —
   * a request that omits a field and one that empties it should look the same to
   * the record. `isActive` is left out entirely: the domain's default is `true`,
   * and a form that never mentions a flag cannot disagree with it.
   */
  const readForm = (): CreateTreatmentInput => ({
    code: code.trim() || null,
    name: name.trim(),
    description: description.trim() || null,
    ...(duration.trim() ? { defaultDurationMinutes: Number(duration.trim()) } : {}),
    ...(priceMajor.trim() ? { defaultPriceMinor: parseMajorUnitsToMinor(priceMajor.trim()) } : {}),
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    // A price box with something in it that does not parse is a price the person
    // meant to give, and `parseMajorUnitsToMinor` answers `undefined` for it —
    // which the schema would read as "absent" and file as no price at all.
    if (priceMajor.trim() && parseMajorUnitsToMinor(priceMajor.trim()) === undefined) {
      setFieldErrors({ defaultPriceMinor: t('treatments.add.invalidPrice') });
      return;
    }

    const input = readForm();
    const parsed = createTreatmentSchema.safeParse(input);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !(key in errors)) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    addTreatment.mutate(parsed.data, {
      onSuccess: () => {
        setCode('');
        setName('');
        setDescription('');
        setDuration('');
        setPriceMajor('');
      },
    });
  };

  const items = catalogueQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('treatments.title')}</h1>
        <p className="text-muted-foreground">{t('treatments.description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('treatments.add.title')}</CardTitle>
          <CardDescription>{t('treatments.add.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="treatment-code">{t('treatments.field.code')}</Label>
                <input
                  id="treatment-code"
                  data-testid="treatment-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={addTreatment.isPending}
                  maxLength={50}
                  placeholder={t('treatments.field.codePlaceholder')}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {fieldErrors.code ? (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldErrors.code}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="treatment-name">{t('treatments.field.name')}</Label>
                <input
                  id="treatment-name"
                  data-testid="treatment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={addTreatment.isPending}
                  maxLength={200}
                  placeholder={t('treatments.field.namePlaceholder')}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {fieldErrors.name ? (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldErrors.name}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="treatment-description">{t('treatments.field.description')}</Label>
                <textarea
                  id="treatment-description"
                  data-testid="treatment-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={addTreatment.isPending}
                  rows={2}
                  maxLength={2_000}
                  placeholder={t('treatments.field.descriptionPlaceholder')}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {fieldErrors.description ? (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldErrors.description}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="treatment-duration">{t('treatments.field.duration')}</Label>
                <input
                  id="treatment-duration"
                  data-testid="treatment-duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  disabled={addTreatment.isPending}
                  type="number"
                  min={1}
                  max={1_440}
                  step={1}
                  inputMode="numeric"
                  placeholder={t('treatments.field.durationPlaceholder')}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {fieldErrors.defaultDurationMinutes ? (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldErrors.defaultDurationMinutes}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <Label htmlFor="treatment-price">{t('treatments.field.price')}</Label>
                <input
                  id="treatment-price"
                  data-testid="treatment-price"
                  value={priceMajor}
                  onChange={(event) => setPriceMajor(event.target.value)}
                  disabled={addTreatment.isPending}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={t('treatments.field.pricePlaceholder')}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                />
                {fieldErrors.defaultPriceMinor ? (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldErrors.defaultPriceMinor}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" data-testid="add-treatment" disabled={addTreatment.isPending}>
                <Plus aria-hidden className="mr-2 h-4 w-4" />
                {t('treatments.add.submit')}
              </Button>
              {addTreatment.isPending ? (
                <p className="text-sm text-muted-foreground" role="status">
                  <Loader2 aria-hidden className="mr-1 inline size-4 animate-spin" />
                  {t('treatments.add.saving')}
                </p>
              ) : null}
            </div>
          </form>

          {failure ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="treatments-catalogue">
        <CardHeader>
          <CardTitle>{t('treatments.catalogue.title')}</CardTitle>
          <CardDescription>
            {items.length > 0
              ? t(
                  items.length === 1
                    ? 'treatments.catalogue.offerCount.one'
                    : 'treatments.catalogue.offerCount.other',
                  { count: items.length },
                )
              : t('treatments.catalogue.descriptionEmpty')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {catalogueQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t('treatments.catalogue.loading')}</p>
          ) : catalogueQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t('treatments.catalogue.loadError')}
            </p>
          ) : items.length > 0 ? (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid="treatment-catalogue-item"
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{item.name}</span>
                    {item.code ? (
                      <span className="ml-2 text-xs text-muted-foreground">{item.code}</span>
                    ) : null}
                    {item.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground">
                    {item.defaultDurationMinutes
                      ? t('treatments.catalogue.duration', {
                          count: item.defaultDurationMinutes,
                        })
                      : ''}
                    <span className="block">{formatMinorUnits(item.defaultPriceMinor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('treatments.catalogue.empty')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
