# NEXT TASK — Dashboard UI/UX improvement

> Saved at session 41 (2026-10-17). This is the queued task for the next session.
> The user supplied a visual mockup **as an image**, which the agent could not read
> (`this model does not support image input`). **Re-supply the mockup image (or its
> file path) at the start of the dashboard session**, or work from the written
> design direction below — the prompt is self-contained enough to proceed without
> it, but the mockup is the primary visual reference.

> **STATUS — DELIVERED, session 42.** Implemented from the written brief below, not
> the mockup. See "Session 42" in `docs/progress/LOG.md` for what changed and how it
> was verified (typecheck / lint / format / build / unit / 124 e2e, all green and all
> counts unchanged). Four deliberate deviations from the text, recorded here rather
> than silently:
>
> 1. **§7 Calendar Preview stays a 14-day booking-density chart**, not a month grid
>    with navigation. The Agenda owns the editable month calendar; a second calendar
>    on the dashboard is two calendars that can disagree about what is booked, and the
>    brief itself says not to introduce one that conflicts with the Agenda. Bar count
>    and bar `title` are pinned by the browser suite and were kept exactly.
> 2. **§4 The greeting does not append a user name.** There is no authentication in
>    this product, so there is no person whose name the page may claim. The subtitle
>    now names the **clinic** (real data from `GET /api/v1/clinic/settings`).
> 3. **§8 Quick Actions offers three actions — Open agenda, Patient records, Treatment
>    catalogue** — not the suggested five. `/payments` and `/reports` have no routes
>    yet, so "Add Payment" and "View Reports" would be dead links; and a second "New
>    Patient" / "New Visit" control on this page would collide with the one the
>    browser suite targets by name and by `data-testid="new-visit"`.
> 4. **§3 Header keeps only the patient search and the theme toggle.** The bell and
>    avatar had no implementation behind them and the brief says not to add controls
>    that look functional but are not.

---

## Objective

Redesign and improve the existing Denti-Code U3 dashboard to match the modern,
professional dental clinic management dashboard mockup provided as a visual
reference.

The goal is to create a clean, polished, responsive dashboard that looks like a
production-ready dental management application.

**Important:** This is a UI/UX improvement task, not a rewrite of the application.
Preserve all existing business logic, database operations, routes, navigation,
permissions, and working functionality.

## 1. Start by inspecting the project

Before modifying anything:

1. Inspect the repository structure and identify the existing React application.
2. Read the project instructions, README, package.json, and relevant development
   documentation.
3. Identify the dashboard page, layout, sidebar, header, metric cards, calendar,
   appointment components, and patient components.
4. Determine which components already exist and which can be reused.
5. Identify the current styling system, such as Tailwind CSS, shadcn/ui, CSS
   modules, or custom CSS.
6. Inspect how dashboard statistics, appointments, patients, payments, and
   treatments are retrieved.
7. Check the current routing, localization, theme handling, and authentication
   context.
8. Run the application using the existing development instructions and inspect the
   current dashboard if possible.

Do not assume that the project uses a particular component library or folder
structure. Follow the actual implementation.

Before coding, provide a brief implementation plan and list the files likely to be
changed. Then proceed with the implementation.

## 2. Visual design direction

Use the provided dashboard mockup as the main visual reference.

### Design principles

- Modern, clean, professional dental clinic software.
- White and very light blue-gray surfaces.
- Dark navy sidebar with a clear active navigation state.
- Bright blue primary actions.
- Soft, subtle color accents for dashboard metrics.
- Rounded cards with consistent spacing and restrained shadows.
- Clear typography and a strong visual hierarchy.
- Consistent icon sizing, alignment, and stroke style.
- Comfortable spacing without excessive whitespace.
- Avoid heavy borders, oversized headings, unnecessary gradients, and overly
  decorative elements.

### Suggested color palette

Use these colors as initial design tokens, adapting them to the project's existing
theme system where necessary.

| Purpose                      | Color     |
| ---------------------------- | --------- |
| Primary blue                 | `#2563EB` |
| Primary hover                | `#1D4ED8` |
| Sidebar background           | `#102344` |
| Sidebar secondary background | `#172E52` |
| Main background              | `#F5F8FC` |
| Card background              | `#FFFFFF` |
| Main text                    | `#172B4D` |
| Secondary text               | `#64748B` |
| Borders                      | `#DFE7F1` |
| Success                      | `#10B981` |
| Warning                      | `#F59E0B` |
| Error                        | `#F43F5E` |
| Information                  | `#3B82F6` |

Create reusable CSS variables or theme tokens instead of scattering color values
throughout the application.

Use accessible text contrast and clear focus indicators.

## 3. Improve the application shell

### Sidebar

Redesign the left navigation to match the reference:

- Dark navy background.
- Denti-Code logo or existing brand mark at the top.
- Application name and a small subtitle.
- Clear active menu item with a blue background and rounded corners.
- Consistent icons and spacing.
- Separating line before Settings.
- Subtle hover and focus states.
- Consistent navigation item heights.

Preserve the existing navigation entries:

- Dashboard
- Patients
- Agenda
- Visits
- Odontogram
- Treatments
- Payments
- Inventory
- Reports
- Settings

Keep existing route destinations and access-control behavior.

If the application already supports role-based navigation, do not expose restricted
pages to unauthorized users.

### Header

Improve the top header with:

- A patient search field.
- Notification control, if supported.
- Theme toggle, if supported.
- User profile or account menu, if supported.
- Current application context where useful.

Avoid adding controls that look functional but have no implementation.

Keep the header compact and aligned with the main content.

## 4. Redesign the dashboard heading

Create a more welcoming dashboard introduction.

Example:

Title: `Good morning, [User Name]`

Subtitle: `Here's what's happening at your clinic today.`

The greeting should adapt to the local time if the application already supports or
can safely implement it.

Use the authenticated user's actual name when available. Do not hardcode a specific
user's name.

Place the primary actions on the right:

- New Visit
- New Patient

These actions must reuse the existing navigation, dialogs, or forms. They must not
create duplicate workflows.

If the project uses Spanish as its default language, keep the dashboard fully
translated and make the English version available through the existing i18n system.

## 5. Redesign the appointment metric cards

Create six visually consistent metric cards:

1. Appointments — booked today.
2. Completed — finished today.
3. Pending — awaiting the patient.
4. In Treatment — patients currently receiving treatment.
5. Cancelled — appointments cancelled today.
6. No-show — patients who did not attend.

Each card should contain:

- A short label.
- A prominent numeric value.
- A brief explanatory caption.
- A meaningful icon.
- A subtle accent color.
- A consistent border radius, padding, and height.
- Optional navigation or filtering behavior only when supported by the application.

Use distinct but restrained accents:

- Appointments: blue.
- Completed: green.
- Pending: amber.
- In Treatment: violet.
- Cancelled: rose.
- No-show: slate or gray.

Keep the metric cards consistent in structure, even when their values are zero.

**Data integrity requirements:**

- Use the existing data sources and repository/service functions.
- Preserve the current appointment status definitions.
- Apply the correct local date boundaries.
- Handle empty datasets and loading states.
- Do not introduce hardcoded statistics or fake records.
- Avoid unnecessary repeated API or database calls.

## 6. Redesign the secondary statistics

Add a row of four compact summary cards:

- Active Patients.
- Collected This Month.
- Pending Treatments.
- Occupancy.

Each card should have an icon, value, label, and optional subtle accent.

Requirements:

- Use the existing patient, payment, treatment, and appointment data.
- Preserve the existing currency configuration and formatting.
- Never hardcode USD or assume a currency.
- Use the application's configured currency, including Bolivian bolivianos if
  supported.
- Define occupancy using the existing business logic where available. If no reliable
  capacity calculation exists, preserve the existing behavior or show an appropriate
  unavailable state instead of inventing a percentage.
- Ensure that monthly totals use the correct month boundaries.

Make these cards compact enough that the primary appointment metrics remain the
dashboard's visual focus.

## 7. Improve the main dashboard layout

For desktop screens, organize the dashboard into a responsive multi-column layout.

Suggested arrangement:

**Main column**

- Today's Appointments.
- Calendar Preview.
- Quick Actions.

**Right column**

- Upcoming Appointments.
- Recent Patients.
- Upcoming Visits.

The primary content should occupy most of the available width, while the right
column provides a useful overview.

Use CSS Grid or the project's existing layout utilities.

Do not hardcode pixel positions or create layouts that only work at one screen
resolution.

### Today's Appointments

Create a clean appointment panel featuring:

- Section title.
- Subtitle showing the applicable timezone when useful.
- Appointment time.
- Patient name.
- Visit or treatment type, if available.
- Status badge.
- Navigation to the corresponding appointment details.

For an empty schedule, display a friendly empty state with a dental-themed icon or
existing illustration, a short message, and an action to open the agenda.

Do not display sample appointments in production.

### Calendar Preview

Improve the calendar with:

- Month and year heading.
- Previous and next month controls.
- Weekday labels.
- A clear current-day indicator.
- Visually distinct scheduled dates when the necessary data exists.
- Appropriate localization.
- Keyboard accessibility where practical.

Use the existing calendar component or scheduling logic if available. Do not
introduce a separate calendar implementation that conflicts with the Agenda page.

Calendar navigation must work, and selected dates should remain consistent with the
underlying application behavior.

### Upcoming Appointments

Create a compact list showing:

- Time.
- Patient.
- Visit type, when available.
- Appointment status.
- A way to open appointment details.

Display a clear empty state when no appointments exist.

### Recent Patients

Display recently registered patients using real data.

Each entry may contain:

- Patient initials or an existing avatar.
- Patient name.
- Patient identifier, if available.
- Registration date or another relevant detail, if supported.

Make entries accessible and clickable only if the project has a valid patient detail
or edit route.

Provide a View All link to the existing Patients page.

### Upcoming Visits

Display the next scheduled visits using existing data.

Include the patient name, date/time, and relevant status when available.

Do not duplicate the same list unnecessarily if Upcoming Appointments and Upcoming
Visits represent the same data. Inspect the existing domain model and distinguish
them only if there is a meaningful difference.

## 8. Add a Quick Actions section

Create a compact section of action cards or buttons:

- New Patient.
- New Visit.
- Add Treatment.
- Add Payment.
- View Reports.

Each action should have a recognizable icon and a concise label.

Requirements:

- Reuse existing application workflows.
- Respect permissions and validation.
- Do not bypass required fields.
- Do not introduce new backend operations unless genuinely necessary.
- Hide or disable unavailable actions according to existing permission conventions.

On smaller screens, the actions should wrap naturally or become a compact grid.

## 9. Improve typography and component consistency

Establish a consistent design scale for:

- Page headings.
- Section headings.
- Card titles.
- Body text.
- Secondary labels.
- Numeric metrics.
- Buttons and navigation labels.

Use the existing font if it is suitable. Avoid adding a new font dependency unless
justified.

Standardize:

- Border radii.
- Card padding.
- Grid gaps.
- Icon sizes.
- Input heights.
- Button heights.
- Status badge styles.
- Focus rings.
- Hover and transition behavior.

Avoid excessive animation. Use short, subtle transitions and respect reduced-motion
preferences.

Prefer existing reusable components over creating multiple components that serve the
same purpose.

## 10. Responsive behavior

Ensure the dashboard works at the following widths:

- Large desktop: 1440px and above.
- Standard desktop: approximately 1280px.
- Small laptop: approximately 1024px.
- Tablet: approximately 768px.
- Mobile: approximately 375–430px, if supported by the application.

Responsive requirements:

- The sidebar should collapse or use an appropriate mobile navigation pattern when
  necessary.
- The main content must not overflow horizontally.
- Metric cards should adapt their column count.
- The right sidebar should move below the primary content on narrow screens.
- Search and header controls should remain usable.
- Buttons must retain readable labels or accessible names.
- Calendar cells must remain legible.
- Tables and lists must preserve essential information.

If Denti-Code is primarily a desktop application, prioritize desktop usability while
ensuring the layout degrades gracefully at smaller sizes.

## 11. Loading, empty, and error states

Improve the visual quality of all dashboard states:

- Loading skeletons or the existing loading indicators.
- No appointments.
- No recent patients.
- No upcoming visits.
- Failed dashboard data requests.
- Missing or unavailable statistics.

Use the project's existing error handling and notification system.

Avoid displaying zero when the value is actually unknown or has failed to load.

Do not introduce fake success states.

## 12. Architecture and implementation constraints

- Keep the existing React application architecture.
- Preserve the existing routing.
- Preserve database and API integration.
- Preserve all existing functionality.
- Reuse existing hooks, services, repositories, and components.
- Follow the project's naming and folder conventions.
- Keep presentation logic separate from business logic where appropriate.
- Avoid unnecessary dependencies.
- Do not migrate backend services or change the database schema for a visual
  redesign.
- Do not rewrite the entire application.
- Do not replace real data with mock data.
- Do not modify unrelated modules.
- Keep localization working.
- Preserve dark mode if it is currently supported.
- Avoid adding duplicate global CSS rules or overriding unrelated pages.

If an existing dashboard feature is broken, identify whether it is directly related
to the redesign. Fix it only when necessary and document the change.

## 13. Testing and validation

After implementation:

1. Run the existing frontend build.
2. Run linting and type checking using the scripts actually defined in the project.
3. Run relevant existing tests.
4. Verify that the dashboard loads with the real application data.
5. Verify all sidebar navigation routes.
6. Verify New Patient and New Visit actions.
7. Verify calendar month navigation.
8. Verify patient and appointment detail navigation.
9. Verify loading, empty, and error states.
10. Verify that statistics use real values and the correct currency.
11. Check for horizontal overflow at desktop and smaller supported widths.
12. Check browser console errors and React warnings.

Do not disable existing tests, lower coverage thresholds, or modify unrelated test
configuration to make the task pass.

If a check fails because of an existing unrelated problem, document it separately
instead of hiding the failure.

If browser automation or screenshot tools are available, capture before-and-after
screenshots at a standard desktop resolution and at a smaller viewport. Compare the
results against the provided reference.

## 14. Definition of done

The task is complete when:

- The dashboard has a substantially improved visual design.
- The result follows the supplied mockup's visual direction.
- The sidebar, header, metric cards, appointment panels, calendar, patient lists,
  and quick actions are visually consistent.
- Real data and existing functionality remain intact.
- Navigation and primary actions work.
- Loading, empty, and error states are handled.
- Localization and currency formatting are preserved.
- The layout is responsive.
- The application builds successfully, or any pre-existing build failures are
  clearly documented.
- Changes are limited to the dashboard and directly related reusable
  layout/components.

## 15. Final report

When finished, provide:

1. A concise summary of the UI improvements.
2. The files created or modified.
3. Any reusable components introduced.
4. Confirmation of which existing features and data sources were preserved.
5. Build, lint, type-check, and test results.
6. Any known limitations or unresolved issues.
7. Screenshots of the finished dashboard, if screenshot tooling is available.

Do not stop after producing a plan. Implement the changes, validate them, and report
the actual results.

The final dashboard should feel like a cohesive, modern dental clinic application—not
merely the existing page with different colors.
