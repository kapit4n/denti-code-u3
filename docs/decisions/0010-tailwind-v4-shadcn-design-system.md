# ADR 0010 — Tailwind CSS v4 + shadcn/ui + a token layer for the design system

- **Status:** Accepted
- **Date:** 2026-09-30
- **Deciders:** Principal Architect
- **Affects:** `packages/ui`, `packages/app/src/styles`, all future UI

## Context

The brief supplies a dashboard mockup as the primary visual reference and asks
for a **reusable design system built around its visual language** — not a
copy-paste reproduction, and not per-component hard-coded styles. The visual
language described: light interface, blue primary, subtle borders, rounded
cards, soft shadows, compact typography, semantic badges, clear hierarchy,
generous whitespace, subtle blue accents. Required coverage: typography,
colors, spacing, radius, shadows, buttons, inputs, selects, cards, badges,
dialogs, dropdowns, tables, tabs, command/search, navigation, tooltips,
loading/empty/error states.

Options considered:

1. **CSS Modules / vanilla-extract** — solid, but no shared token ecosystem and
   no ready primitives; everything would be hand-built.
2. **Ant Design / MUI / Mantine** — complete component libraries, but they impose
   their own visual identity, which would fight the specified design language,
   and they are heavy.
3. **Tailwind CSS v4 + shadcn/ui + a project token layer** (chosen).
4. **Tailwind v3** — the previous stable major; v4's CSS-first `@theme` is a
   better fit for token ownership and is the current standard for shadcn/ui.

## Decision

Use **Tailwind CSS v4** with **shadcn/ui** primitives as the foundation, wrapped
by a **Denti-Code token layer** in `packages/ui`.

- **Tokens are defined once**, in CSS, as Tailwind v4 `@theme` variables derived
  from the design language (brand blue scale, neutral/surface scale, semantic
  status colours, radii, shadows, typography scale, spacing). Every component
  consumes semantic tokens (`bg-surface`, `text-muted-foreground`,
  `border-border`, `bg-primary`), never raw palette values.
- **Status colour is derived, never hard-coded.** Appointment statuses (and any
  other domain status) map through a single `appointmentStatus → semantic tone`
  mapping in `packages/ui` (or a feature-level status-meta module) so the
  domain never carries colours and the palette never leaks into the domain.
- **shadcn/ui components are vendored into `packages/ui/src/components/ui/`**,
  not consumed from `node_modules`. This is what makes them _our_ design system:
  we own the source, can restyle them to the Denti-Code language, and they live
  in one place.
- `cn()` (clsx + tailwind-merge) lives in `packages/ui` and is the only class
  composition helper. No other `utils.ts` in the codebase.
- Light theme is the default. Dark theme is prepared at token level (a `[data-theme="dark"]`
  token override) but is not the Phase-1 focus.
- Iconography: Lucide React, one stroke weight (1.5–2), sized via tokens.

## Rationale

- **Utility-first + primitives** gives the speed of Tailwind without a
  rigid component library's visual opinions. Tailwind v4's CSS-first `@theme`
  makes the token layer a first-class, single-source-of-truth design system.
- **shadcn/ui is code, not a dependency.** Vendoring means components can be
  modified to the clinic's density, typography and colours — exactly what a
  premium, information-dense clinical UI needs.
- **Semantic tokens make the design language consistent** and make the future
  dark theme a token change instead of a component rewrite.
- **Derived status colours** satisfy the architectural rule that domain statuses
  are data and colours are a presentation concern.

## Consequences

Positive:

- Consistency: one place defines colour, radius, shadow and type scale.
- Dense, professional UI without fighting a third-party visual identity.
- Dark theme and future brand adjustments are token-level changes.
- Primitives are reusable and individually testable.

Negative / accepted costs:

- **Vendored components are now our maintenance burden.** Accepted: that is the
  point of a design system; upstream changes are cherry-picked deliberately.
- **Tailwind v4 requires explicit `@source` globs** in a monorepo so the shared
  app package and `packages/ui` are scanned. Configured in
  `packages/app/src/styles/globals.css`.
- **Utility classes in JSX can sprawl.** Mitigation: feature components stay
  small and prefer `packages/ui` primitives; shared composed patterns move to
  `packages/app/src/shared/`.
- The token layer is an upfront cost before the first screen exists. Accepted:
  the brief explicitly asks for a design system, not screens.

## Alternatives rejected

- **Ant Design / MUI:** heavy, opinionated look, hard to reach the specified
  visual language, extra runtime cost. Rejected.
- **CSS Modules:** no token/utility ecosystem, more bespoke work for the same
  result. Rejected.
- **Tailwind v3:** workable, but v4's `@theme` token model and faster build are a
  better base. Rejected.
- **Copying the mockup literally:** rejected by the brief — it asks for a
  reusable system built around the visual language.

## Verification

- `pnpm --filter @denti-code-u3/web build` succeeds, proving Tailwind v4
  resolves and scans the shared packages.
- `pnpm run guard:boundaries` ensures `packages/ui` imports no feature or domain
  code.
- A component test asserts that a semantic-status badge maps through the shared
  status→tone mapping rather than a literal colour class.
