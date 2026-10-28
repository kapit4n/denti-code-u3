/**
 * The application's locale contract.
 *
 * Spanish is the product default because the clinic this application is built
 * for works in Spanish. English stays a first-class catalogue rather than a
 * development leftover: it is the fallback for a deployment that has not been
 * translated yet, and the language the existing browser suite was written in.
 */

export const LOCALES = ['es', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_STORAGE_KEY = 'denti-code-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The stored choice, or Spanish.
 *
 * `localStorage` is read through a guard because a privacy-restricted webview
 * can throw on access. A language preference that crashes the shell is worse
 * than one that falls back to the product default.
 */
export function readStoredLocale(storage: Pick<Storage, 'getItem'> | undefined): Locale {
  if (!storage) {
    return DEFAULT_LOCALE;
  }

  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
