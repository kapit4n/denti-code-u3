/**
 * Tailwind v4 is configured in CSS (the `@theme` block) rather than in a
 * JavaScript config file. This module only exists so that the Vite plugin can be
 * consumed from one shared place.
 */
import tailwindcss from '@tailwindcss/vite';

export { tailwindcss };
export default tailwindcss;
