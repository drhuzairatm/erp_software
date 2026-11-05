# Phase 11: Dashboards and Reports

**Status:** built and tested on the throwaway database. No migration was needed. Nothing is committed, pushed or deployed.

All figures come from live queries limited by permission, RLS and the selected company scope. The existing dashboard and report engine were extended; no second dashboard was added.

| Area | Existing | Added |
|---|---|---|
| Admissions | Totals, new registrations, active, country, course, stage | University-wise and intake-wise cards, `by-intake` report |
| Finance | Revenue trend, per-currency fees, INR equivalents | Links to the Phase 10 reports |
| Employee | Staff performance table, workload | Attendance today, task totals per company, `attendance-summary` and `employee-tasks` reports |
| Operations | Stage chart, waiting on external parties | Pending documents, verification requests, open student questions, university application, admission letter and visa counts, upcoming deadlines |

## Filters

| Filter | Where it applies |
|---|---|
| Date | All filtered reports. Student reports use the registration date, finance reports the entry date, employee reports the period |
| Country, programme | Student and finance reports. "Programme" is the existing Course field |
| Department | Employee reports only. A student has no department, so this filter is not offered on student reports |

## Access

`attendance-summary` needs `attendance.view` and `employee-tasks` needs `staff.workload.view`, as well as `reports.view`. Exports use the existing permission check and audit.

## Limits to read with these numbers

- **Absent:** the system marks nobody absent on its own. A recorded absence and "no record" are shown separately. No record can include staff not required to mark attendance, such as directors.
- **Holidays:** no holiday calendar exists, so only weekly days off are excluded from working days.
- **Attendance values** (hours, grace, weekly off) remain unconfirmed placeholders, and overnight shifts are not supported.
- **Consolidated view:** someone in both companies counts once per company.
- **Long ranges:** employee reports cover at most about a year.
- **Visa and admission progress** are counts of students at those stages, not a separate visa workflow.
- **Trends:** the revenue chart shows the first currency only; the per-currency table holds the others.
