/**
 * Denti-Code U3 design system.
 *
 * `packages/ui` owns the visual language: design tokens (as CSS custom
 * properties consumed through Tailwind's `@theme`), the `cn()` class helper and
 * shadcn/ui-derived primitives.
 *
 * It knows nothing about clinics, appointments or patients — a component here
 * must be reusable for any screen. Anything that knows what a "patient" is
 * belongs in `packages/app/src/features`.
 */

export { cn } from './cn.js';
export type { StatusTone } from './status-tone.js';
export { STATUS_TONE_CLASS, toneForStatus } from './status-tone.js';
