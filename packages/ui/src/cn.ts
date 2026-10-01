import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names for a component.
 *
 * `clsx` handles conditional composition; `tailwind-merge` resolves conflicting
 * Tailwind utilities so a caller's `className` always wins over a component's
 * own default. Without the merge step, `className="p-4"` could not override a
 * component's built-in `p-2`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
