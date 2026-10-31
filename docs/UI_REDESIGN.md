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
  - **No official logo files exist in the project. No logo was drawn.** Place official files at `public/brands/edx-logo.svg|png` and `public/brands/grd-logo.svg|png` and they appear automatically.
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
| All other modules | Restyled through the shared components (tasks, payments, reports, universities, administration, audit). Behaviour unchanged. |

## Business rules checked against the redesign
- **Passport:** less than 12 months never blocks registration (the blocking rule applies from University Application, as approved). Expired passports show a red warning.
- **Academic requirements:** advisory only, with acknowledgement; nothing invented.
- **Finance:** the CEO sees no amounts on either dashboard view (tested).
- **Company separation and permissions:** unchanged (all queries run under RLS).

## Gaps found — need decisions (NOT changed)
1. **"A new passport becomes active only after verification."** Today a recorded renewal becomes current immediately; old versions are kept. Changing this alters the passport model and needs approval.
2. **Courier workflow** (front-and-back scans → approval → courier instructions → parent submits courier and tracking number → staff confirm receipt). It isn't built yet (planned Phase 10).
   - The portal shows no courier instructions.
   - It tells students not to send originals until their scans are approved.
3. **Lead management:** not in this ERP yet (Phase 9; leads come from both this ERP and Leadist). No lead screens were faked.
4. **Student portal payment status and in-portal notifications:** not enabled (portal Phase 6). The portal shows a pointer to the counsellor.
5. **Official logos:** missing files (see above).

## Not yet given a bespoke layout (use the restyled shared components)
Tasks board/list, payment ledger, reports gallery, university detail, administration pages, audit log, document review workspace.
These are functional and consistent, but haven't had individual visual redesigns. That's the suggested next step.
