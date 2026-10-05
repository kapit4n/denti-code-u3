/**
 * The colour a dentist's chip is drawn in.
 *
 * `dentists.color` is a plain `text` column with no constraint and no validation
 * anywhere between the database and this function — the seed data holds `#0ea5e9`,
 * and nothing stops a clinic typing `#fff`, `red`, or something else entirely. It
 * arrives in a REST response from an unauthenticated-in-practice admin screen, and
 * the tempting thing to do with a string like that is to hand it to `style`, which
 * turns a text column into an inline-style injection point.
 *
 * So the value is matched against the only shapes a colour can take here — a
 * three- or six-digit hex triplet — and anything else is answered with `undefined`.
 * A clinician whose colour is stored as `chartreuse` gets a chip with no swatch,
 * which is a cosmetic absence, rather than a chip the browser interprets as
 * whatever it liked.
 *
 * The domain already settled that the colour belongs to the chip rather than to this
 * file: `DentistSummary.color` is read "rather than invented in the UI because two
 * dentists sharing a chip colour on the agenda's filter is a bug the clinic cannot
 * fix without a deployment". This is the other half of that sentence — the chip
 * shows what the clinic chose, and only what it can safely be told.
 */

/** `#rgb` and `#rrggbb`, either case, with surrounding whitespace ignored. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function dentistChipColor(color: string | null | undefined): string | undefined {
  if (typeof color !== 'string') {
    return undefined;
  }

  const candidate = color.trim();
  return HEX_COLOR.test(candidate) ? candidate : undefined;
}
