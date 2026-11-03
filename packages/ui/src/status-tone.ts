/**
 * Status tone: the single visual vocabulary for state.
 *
 * A screen never picks a colour for a status. It asks for a *tone* and the
 * design system decides the colour, so "cancelled" looks the same on the
 * agenda, in the patient chart and in a table.
 *
 * This module is deliberately generic: it knows about tones and raw status
 * strings, nothing about appointments, invoices or visits. Mapping a domain
 * status onto a tone belongs in the feature that owns that status.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Tone → CSS custom properties declared in `globals.css`. */
export const STATUS_TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

/**
 * Tone → a badge that stays legible on a coloured surface.
 *
 * The pastel fill above is right on a card, but a blue status word on a blue agenda
 * block disappears. These badges carry their own card-coloured surface and a matching
 * border, so the state reads the same on a white panel and on a filled calendar block.
 * The `-text` colours are the darker tone shades, chosen to keep small text readable
 * on that light surface.
 */
export const STATUS_TONE_BADGE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: 'border-border bg-card text-muted-foreground',
  info: 'border-info/40 bg-card text-info-text',
  success: 'border-success/40 bg-card text-success-text',
  warning: 'border-warning/50 bg-card text-warning-text',
  danger: 'border-danger/40 bg-card text-danger-text',
};

/**
 * Best-effort tone for an arbitrary status string.
 *
 * This is a *presentation fallback* for statuses that have no explicit mapping
 * yet (a new domain status, a raw enum value from the API). Feature code should
 * map its own statuses explicitly; this exists so an unmapped status still
 * renders in a sensible colour instead of falling back to arbitrary styling.
 */
export function toneForStatus(status: string): StatusTone {
  const normalised = status.toLowerCase();

  if (
    normalised.includes('cancel') ||
    normalised.includes('void') ||
    normalised.includes('delete') ||
    normalised.includes('reject')
  ) {
    return 'danger';
  }
  if (
    normalised.includes('no_show') ||
    normalised.includes('noshow') ||
    normalised.includes('expir') ||
    normalised.includes('pending') ||
    normalised.includes('draft')
  ) {
    return 'warning';
  }
  if (
    normalised.includes('complete') ||
    normalised.includes('paid') ||
    normalised.includes('active') ||
    normalised.includes('accept') ||
    normalised.includes('arrived')
  ) {
    return 'success';
  }
  if (
    normalised.includes('progress') ||
    normalised.includes('treat') ||
    normalised.includes('confirm') ||
    normalised.includes('schedul') ||
    normalised.includes('present') ||
    normalised.includes('partial')
  ) {
    return 'info';
  }
  return 'neutral';
}
