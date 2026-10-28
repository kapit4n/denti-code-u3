import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider, useTranslation } from './index.js';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from './locale.js';

function Probe() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="greeting">{t('dashboard.greeting.morning')}</p>
      <p data-testid="count">{t('patients.list.registered.other', { count: 12 })}</p>
      <button type="button" onClick={() => setLocale('en')}>
        English
      </button>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe('I18nProvider', () => {
  it('uses Spanish by default', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent(DEFAULT_LOCALE);
    expect(screen.getByTestId('greeting')).toHaveTextContent('Buenos días');
    expect(screen.getByTestId('count')).toHaveTextContent('12 registrados');
    expect(document.documentElement.lang).toBe('es');
  });

  it('restores a stored language choice', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('greeting')).toHaveTextContent('Good morning');
    expect(document.documentElement.lang).toBe('en');
  });

  it('persists a language change and updates the document language', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('greeting')).toHaveTextContent('Good morning');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps component tests in English when there is no provider', () => {
    render(<Probe />);

    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('greeting')).toHaveTextContent('Good morning');
  });
});
