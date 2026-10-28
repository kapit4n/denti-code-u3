/**
 * The one place a component may ask what language the clinic reads.
 *
 * A provider rather than a module-level `t()`: the language is user state, and a
 * module singleton would make two mounted applications (a test rendering one
 * beside another) share the last choice. The context fallback is English so a
 * component test that renders a section on its own keeps the strings it was
 * written against; the real application always sits inside the provider.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { translate, type TranslationKey, type TranslationParams } from './catalog.js';
import {
  browserStorage,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  type Locale,
} from './locale.js';

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export interface I18nContextValue {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: Translate;
}

const fallbackContext: I18nContextValue = {
  locale: 'en',
  setLocale: () => undefined,
  t: (key, params) => translate('en', key, params),
};

const I18nContext = createContext<I18nContextValue>(fallbackContext);

export interface I18nProviderProps {
  readonly children: ReactNode;
  /**
   * Overrides the stored choice once, for tests and for a shell that wants to
   * pin a language. Changing languages afterwards still persists normally.
   */
  readonly initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale(browserStorage()),
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      browserStorage()?.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // A webview that refuses storage still gets the language for this session.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export { DEFAULT_LOCALE };
