# ADR 0032 — UI language is a typed catalogue, Spanish by default

- Status: accepted
- Date: 2026-10-28
- Decides: how the application renders copy in more than one language, which
  language opens by default, and how a missing translation is caught.
- Related: [0001](0001-monorepo-pnpm-turborepo.md) (the application package),
  [0006](0006-feature-oriented-frontend.md) (feature-owned copy),
  [0025](0025-two-engines-sqlite-runs-postgresql-kept.md) (the same rule of an
  explicit second implementation, applied to catalogues).

## Context

The clinic this product is built for reads Spanish, while the application and
its browser suite were written in English. A language switch was needed for the
dashboard and patient surfaces first, without turning every component into a
translation framework and without letting an untranslated key reach the screen.

The application already had one React package shared by web and desktop, so the
choice had to work identically in both shells. It also had tests that render a
component on its own, without the application's providers.

## Decision 1 — A small provider, not an i18n dependency

`packages/app/src/i18n` owns the locale and the catalogues. Components call
`useTranslation()` and `t(key, params)`; the provider sits once in the root route,
so both shells inherit it. There is no `i18next`, no plugin chain and no
language detector: the product has two known catalogues and one persisted
choice, and a dependency would be larger than the problem.

The context fallback is **English**. A component test that mounts one section
without the provider keeps the strings it was written against; the real
application always renders inside the provider.

## Decision 2 — The English catalogue defines the key space

`packages/app/src/i18n/locales/en` is the source of truth. `TranslationKey` is
`keyof typeof en`, and the Spanish catalogue is declared as
`es satisfies Record<TranslationKey, string>`. Adding an English key without its
Spanish sibling therefore fails `pnpm run typecheck`; adding a Spanish key with
no English key fails too. Feature copy lives in that feature's catalogue
(`common`, `dashboard`, `patients`), matching the feature-oriented frontend.

English values deliberately keep the labels the UI already showed, including the
uppercase status, condition and surface names. Translation is not a copy rewrite:
the English catalogue records today's product language, while the Spanish
catalogue uses natural clinical Spanish. The two may diverge in tone without
changing what a status means.

## Decision 3 — Interpolation is tiny; plurals are explicit

`translate` replaces `{name}` placeholders and nothing else. There is no
template language, escaping or plural engine. A count that changes the sentence
has two keys — `.one` and `.other` — chosen by the caller, so both sentences are
visible to a translator and no grammar rules are hidden in code. Dates and
money keep their existing formatters.

Enum values reach the catalogue through `enumLabel(t, prefix, value)`, the one
place where an API string becomes a known key. An unknown value falls back to
the raw code there rather than in every component.

## Decision 4 — Spanish opens first, and the choice persists

`DEFAULT_LOCALE` is `'es'`. The stored preference is read from
`localStorage['denti-code-locale']` through a guard that tolerates a webview
refusing storage. `setLocale` updates the provider, persists the choice and sets
`document.documentElement.lang`. The header offers the switch in both
directions (`Cambiar a inglés` / `Switch to Spanish`).

The existing browser suite was written in English. Its shared fixture pins
`denti-code-locale=en` before the first navigation, and the new Spanish spec
overrides it after that initializer. Router and mount tests seed the same choice.
The suite therefore tests both the translated flow and the legacy assertions
without translating every expected string in the same change.

## Consequences

- A future screen must add both catalogues in the same change; typecheck is the
  guard, not a review checklist.
- The first slice translates the shell, the dashboard and the patient pages.
  Agenda, visits, treatments, inventory, reports, settings and the login screen
  still render their existing English copy until they are translated. This is a
  visible, honest gap rather than a claimed complete localisation.
- There is no locale negotiation from `Accept-Language`, no right-to-left
  layout and no translated API error prose. Known failure kinds are translated
  in the client; an unknown server message is still quoted as the server wrote
  it.
- Component tests keep an English fallback; a test that wants Spanish renders
  inside `I18nProvider` or asserts the provider's own behaviour.
