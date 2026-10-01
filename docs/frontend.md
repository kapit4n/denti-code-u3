# Denti-Code U3 — Frontend Architecture

Companion to [`architecture.md`](./architecture.md). Describes the React
application: structure, routing, state, feature layout, design system usage and
the platform abstraction.

---

## 1. One application, two shells

```
packages/app/          THE React application (routes, providers, features, styles)
apps/web/              browser shell: index.html + vite config + main.tsx
apps/desktop/          Tauri 2 shell: same, plus src-tauri/
```

See [ADR 0008](./decisions/0008-one-react-app-package-with-thin-shells.md). Each
shell's `main.tsx` is three lines and identical:

```tsx
import { AppRoot } from '@denti-code-u3/app';
import '@denti-code-u3/app/styles';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing from index.html');

createRoot(root).render(<AppRoot />);
```

Neither shell may contain routes, components, stores or queries.

## 2. Directory layout

```
packages/app/src/
├── app-root.tsx            Providers: Router, QueryClient, Platform, Theme
├── query-client.ts         QueryClient factory (shared with tests)
├── route-tree.gen.ts       TanStack Router generated route tree
├── routes/
│   ├── __root.tsx          Document shell (theme, global styles)
│   ├── app-layout.tsx      Sidebar + header + outlet (Milestone 2)
│   └── ...                 Feature routes wired by TanStack Router
├── features/
│   ├── dashboard/          (scaffold, Milestone 3)
│   ├── agenda/             (scaffold, Milestone 5)
│   ├── patients/           (scaffold, Milestone 4)
│   ├── visits/             (scaffold, Milestone 6)
│   ├── odontogram/         (scaffold, Milestone 7)
│   └── settings/           (scaffold)
├── shared/
│   ├── page-frame.tsx      Consistent page header/content/footer composition
│   ├── query-state.tsx     <QueryState/> loading|error|empty with retry
│   ├── command/            Global search / command palette scaffolding
│   └── cn.tsx?             (no — cn lives in packages/ui)
├── platform/               ADR 0009
└── styles/globals.css      Tailwind v4 @theme tokens + base layer
```

Each feature uses the layout in [ADR 0006](./decisions/0006-feature-oriented-frontend.md).

## 3. Routing (TanStack Router)

- Type-safe routes with `createRootRoute`, `createRoute`, `createRouter`.
- Generated route tree (`@tanstack/router-plugin` in Vite) so route paths and
  params are inferred — a bad link is a type error, not a runtime 404.
- Layout route `app-layout` hosts the sidebar/header and renders `<Outlet/>`.
- Route files live in `features/<feature>/routes/` and are assembled by
  `packages/app/src/routes/`.

Target route map (only existing screens are created — no placeholders for
features that do not exist yet):

| Route                                  | Feature   | Milestone |
| -------------------------------------- | --------- | --------- |
| `/dashboard`                           | dashboard | 3         |
| `/agenda`                              | agenda    | 5         |
| `/patients`                            | patients  | 4         |
| `/patients/$patientId`                 | patients  | 4         |
| `/patients/$patientId/visits/$visitId` | visits    | 6         |
| `/visits/$visitId`                     | visits    | 6         |
| `/settings`                            | settings  | 12        |

`/` redirects to `/dashboard`. Unknown paths render a not-found route.

## 4. Data flow (request → screen)

```
Component
  └─ useXQuery()                     features/x/queries/*-query.ts
       └─ queryFn: getX()           features/x/api/get-x.ts  (use case)
            ├─ import { XRepositoryPort }-style contract from @denti-code-u3/domain
            ├─ apiClient.get('/x', { query })   @denti-code-u3/api-client
            └─ parseXResponse(raw)             @denti-code-u3/validation (Zod)
       └─ queryKey: xKeys.detail(id)  features/x/queries/x-keys.ts
  └─ useXMutation()                  features/x/mutations/*-mutation.ts
       └─ mutationFn: createX(input) → apiClient.post → invalidateQueries(xKeys.all)
```

Invariants:

- Components never call `apiClient` directly; they use the feature's hooks.
- Query keys always come from a `*-keys.ts` factory (never string literals).
- Response parsing uses the shared Zod schema from `packages/validation`, so the
  UI can trust the shape it receives.
- Loading/empty/error rendering goes through `<QueryState/>` in `shared/` so every
  screen behaves identically.

## 5. State management

Per [ADR 0007](./decisions/0007-server-state-tanstack-query-client-state-zustand.md):

- **Server state → TanStack Query.** Cache, invalidation, retries, loading state.
- **Local state → Zustand**, one small store per concern, colocated with the
  feature. Examples: `agenda-filters-store`, `sidebar-store`,
  `preferences-store` (persisted through the platform storage port).
- **URL state → TanStack Router search params.** Filters and selection that
  should survive a reload or be shareable belong in the URL (e.g. agenda
  `?dentistId=&chairId=&date=`).
- **Component-local state → `useState`/`useReducer`** only.

Priority rule when choosing: _if it would be wrong after a refresh, it is URL
state; if it comes from the server, it is query state; if it is only for this
session on this device, it is Zustand; otherwise local._

## 6. Design system usage

- Tokens are consumed as semantic Tailwind utilities (`bg-surface`,
  `text-muted-foreground`, `rounded-card`, `shadow-card`) defined once in
  `packages/app/src/styles/globals.css` via Tailwind v4 `@theme`.
- Primitives are imported from `@denti-code-u3/ui` (`Button`, `Input`,
  `Select`, `Card`, `Badge`, `Dialog`, `DropdownMenu`, `Tabs`, `Table`,
  `Tooltip`, `Command`, `Skeleton`).
- **Never** write a raw hex value or a raw palette shade in a component.
- Status colours are derived through a single mapping from the domain status to
  a semantic tone — see §9.
- `cn()` from `@denti-code-u3/ui` is the only class-composition helper in the
  codebase.

## 7. Platform abstraction

```ts
import { usePlatform } from '@denti-code-u3/app/platform';

const platform = usePlatform();
if (platform.capabilities.canPrint) await platform.printing.printHtml(html);
```

Feature code never imports `@tauri-apps/*`, never checks `isTauri`, never calls
`invoke`. Capabilities are optional and reported honestly
([ADR 0009](./decisions/0009-platform-abstraction.md)).

## 8. Forms and validation

- React Hook Form + Zod resolver for forms.
- Form schemas live in `packages/validation` when they define an API contract, or
  in the feature's `schemas.ts` when they are purely a UI concern; both reuse the
  same Zod building blocks to avoid duplicated rules.
- The browser's `required`/`type` attributes come from the schema
  (`Controller` + schema-derived attributes), so client validation mirrors the
  server rather than diverging from it.

## 9. Appointment status presentation (derived, not hard-coded)

```
packages/domain/appointment/appointment-status.ts   → SCHEDULED | CONFIRMED | …
                                  │
                                  ▼  (single mapping, packages/app or packages/ui)
features/agenda/appointment-status-tone.ts          → 'neutral' | 'info' | 'success' | 'warning' | 'danger'
                                  │
                                  ▼
<Badge tone="warning">En tratamiento</Badge>
```

The domain never carries a colour. The mapping is one exhaustive function with a
`Record<AppointmentStatus, Tone>` type, so adding a status is a compile error
until its presentation exists — exactly the desired coupling.

## 10. Agenda / calendar integration

Per [ADR 0011](./decisions/0011-fullcalendar-as-view-adapter.md): FullCalendar
appears only inside `features/agenda`, behind `adapters/to-calendar-event.ts` and
`adapters/from-calendar-event.ts`. Queries return domain-shaped appointments.

## 11. Accessibility & density

- Semantic HTML first; interactive primitives are real buttons/links.
- Visible focus rings using the design-system focus token; keyboard navigation
  for the command palette and menus.
- Density is a token concern (`density` attribute → spacing tokens), because a
  clinic agenda is information-dense by necessity.

## 12. Performance

- Route-level code splitting is automatic with TanStack Router.
- Query caching and stale times are set per feature, not globally.
- Virtualisation is introduced only when a list is measurably slow (e.g. the
  patients list); not assumed.

## 13. Testing the frontend

- Component tests mount the smallest unit that carries behaviour (a component or
  a feature route), with a test `QueryClient` and a fake platform.
- Query options and adapters are tested without rendering.
- MSW-style HTTP stubbing is avoided in Phase 1; the api-client is mocked at the
  module boundary until a real HTTP stubbing layer is introduced (see
  `docs/testing.md`).
