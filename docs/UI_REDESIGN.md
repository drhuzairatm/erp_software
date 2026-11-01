# Premium UI redesign — implementation record (Nov 2026)

The interface was redesigned inside the existing app. The backend, database, permissions, workflows and data are unchanged.
The only new server code is two **read-only** query services for the dashboards (`src/server/services/analytics.ts`), which run under the same row-level security and company scope as before.

## Design system
- **Tokens** (`src/app/globals.css`):
  - GRADUATER colours as supplied: Midnight Navy `#0B1020`, Electric Cyan `#36D9FF`, Aurora Teal `#24E0B8`.
  - Dr.Expert Edulinks keeps the existing app blue. No official Edulinks colours exist in the project, so none were invented.
  - The accent follows the active company (`data-brand="edx|grd|all"`).
  - Rounded cards, soft shadows, refined inputs, buttons and tables.
- **Branding** (`src/lib/brands.ts`, `src/components/brand-mark.tsx`):
  - Each company is shown with its own name; the two are never merged into one mark.
  - **Official logos** (supplied by the MD, Nov 2026) are in `public/brands/edx-logo.png` and `public/brands/grd-logo.png`. These are cropped copies of the supplied files, which are kept unchanged as `public/public:brands:*.png`. They appear on the sidebar, sign-in and portal. Nothing was drawn or recoloured.
  - The site icon (`src/app/icon.svg`) is a neutral graduation cap, not a company logo.
- **Components:**
  - `components/icons.tsx` (icon set)
  - `components/charts.tsx`: bar, donut, line, radial progress, sparkline and horizontal bars. These are dependency-free SVG, responsive, and include a text alternative.
  - `components/notice.tsx`: red / amber / blue / green alerts, always with an icon and a text label.
  - `components/ui.tsx`: KPI card with icon and mini chart, page header, cards and empty states.
  - `components/auth-shell.tsx`: sign-in layout.
- **Layout:**
  - Dark navy sidebar with a cyan active indicator, grouped navigation and the company selector.
  - On phones and tablets the sidebar becomes a slide-in drawer.
  - The sticky top bar has student search, alerts and a profile menu.

## Screens
| Screen | What changed |
|---|---|
| Staff dashboard ("Operations") | Welcome banner and quick actions; personal KPIs; priority attention; "My students" status table with document progress; today's follow-ups; quick actions; recent activity timeline; the complete previous team overview (filters, all figures, stage chart, external waits, finance or counts, workload) kept below. |
| Management analytics (default for MD/CEO; managers can switch) | Date, destination and course filters; KPI cards with sparklines; monthly admissions bar chart; country and stage donuts; course bars; performance rings; revenue trend and amounts (**finance permission only — the CEO sees counts and a notice**); yearly admissions; company comparison (consolidated view); staff performance. All figures are live. |
| Student portal | Mobile-first branded header; progress ring; next step; summary counts; visual stage tracker; documents grouped (needed, being checked, approved); instructions; payments pointer; contact. |
| Staff and student sign-in | Split-screen branded layout. |
| Student list and profile | Avatars and stage pills; gradient profile header with initials and a stage progress bar; pill tabs; the attention panel stays on every tab. |
| Tasks | KPI cards (open, overdue, due today, high priority, completed in 7 days); view tabs with counts; **List / Board** switch (board columns by status, cards with a priority stripe, due chip and assignee avatar). Task detail: summary tiles, chat-style comments, timeline history. |
| Payment ledger | KPI cards per currency (verified receipts in 30 days with a 6-month sparkline, charges, refunds and disbursements, awaiting verification); verification tabs; signed, colour-coded amounts. Shown only to users with `payments.read`, so the CEO never sees it. |
| Reports | Gallery grouped by Students, Documents & compliance, Work and Finance; export and sensitivity tags; new "Original documents by courier" report. |
| Universities | KPI cards; card grid with course pills, students, campuses, document rules and next deadline; detail page with an overview band. |
| Administration | Section bar on every admin page, showing only the sections the user may open; staff KPIs and avatars; new Courier addresses page. |
| Audit log | Outcome tabs; day-grouped activity feed with actor avatars and outcome dots; before → after shown for changed fields only. |
| Document review | Progress stepper (uploaded → review → verified → manager approval → approved); timeline status history. Viewer and checklist unchanged. |
| Student documents | New "Originals by courier" panel (tracker, courier details, receipt, reconciliation, history). |

## Business rules checked against the redesign
- **Passport:** less than 12 months never blocks registration (the blocking rule applies from University Application, as approved). Expired passports show a red warning.
- **Academic requirements:** advisory only, with acknowledgement; nothing invented.
- **Finance:** the CEO sees no amounts on either dashboard view (tested).
- **Company separation and permissions:** unchanged (all queries run under RLS).

## Gaps found earlier — now decided
1. **"A new passport becomes active only after verification":** built (see PASSPORT_AND_CONTACTS.md).
2. **Courier workflow:** built for inbound originals (see UAT G6). The portal shows the address only after scan approval.
3. **Lead management:** not in this ERP yet (Phase 9). No lead screens were faked.
4. **Portal payment status and in-portal notifications:** not enabled (portal Phase 6).
5. **Official logos:** installed.

## Shared components added in part 2
`ViewTabs` (pill tabs with counts), `Avatar` (initials), `FilterBar` in `components/ui.tsx`; `admin/admin-tabs.tsx`; the `truck` icon.
