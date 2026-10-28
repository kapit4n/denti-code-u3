/**
 * The catalogue boundary.
 *
 * The English catalogue is the source of truth for the key space: `TranslationKey`
 * is derived from it, and the Spanish catalogue is checked against that union at
 * compile time. A screen that adds an English string without its Spanish sibling
 * therefore fails `pnpm run typecheck` rather than shipping a half-translated UI.
 */

import type { Locale } from './locale.js';
import { en } from './locales/en/index.js';
import { es } from './locales/es/index.js';

export type TranslationKey = keyof typeof en;

export const catalogs = {
  en,
  es: es satisfies Record<TranslationKey, string>,
} as const;

export type TranslationParams = Record<string, string | number>;

/**
 * Interpolation is deliberately tiny: `{name}` placeholders and nothing else.
 *
 * A template engine would add plural rules, escaping and date syntax — three
 * things the API already owns or `Intl` does better. Plural keys are explicit
 * (`.one` / `.other`) so a translator can see both sentences.
 */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template = catalogs[locale][key] ?? catalogs.en[key] ?? key;

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}
