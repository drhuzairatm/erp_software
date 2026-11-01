# Rule engine: shared AND/OR conditions (Phase 4, approved 1 Nov 2026)

## What it does
Every rule type below can have **extra conditions**, built with the same visual editor. Conditions can use **ALL (and)** and **ANY (or)** groups, nested up to three levels:
- **Document verification rules**, including Bonafide wording (Admin → Verification rules, on drafts)
- **Attestation / apostille routes** (on drafts)
- **Passport validity rules** (Admin → Passport & contact rules)
- **One and Same rules** (Admin → Academic & name rules)
- **University document requirements**, which decide what goes on a student's checklist (University page)

Conditions are added on top of a rule's existing settings (country, university, course and so on). A rule with no conditions behaves exactly as before.
Approved verification rules and attestation routes stay frozen, and a new version copies its conditions.

## Facts you can use
| Fact | Source |
|---|---|
| Nationality | Current **verified** passport; the issuing country if nationality isn't recorded |
| Citizenship, passport issuing country | Current passport |
| Country of residence, previous education country, school country | Student record |
| Destination, visa application country, university, course, intake, company, current stage, lead source | Student record |
| Document type, document issuing country | The document being checked (verification and attestation) |
| Age (years) | Date of birth |
| Passport validity (months left) | Passport expiry |

Comparisons:
- **is one of / is not one of:** for countries, universities, courses and similar.
- **is at least / is at most:** for numbers.
- **is recorded / is not recorded:** for any fact.

A fact that isn't recorded never matches "is one of" or "is not one of". Unknown data is never treated as a match.

## Checklists
University document requirements with conditions are added only for matching students.
- The checklist is re-checked when a fact changes, for example when a passport is verified or the residence country is edited.
- Items are **added, never removed**, so nothing a student has already uploaded disappears.

## Rule tester (Admin → Rule tester)
- **Check a student:**
  - enter a Student ID, and optionally a document
  - see every active rule of every type, whether its scope matches, and a step-by-step explanation of its conditions
  - see the facts used
  - the explanation is checked against the database evaluator, which is authoritative
- **Preview a condition:** build a condition and see how many active students you can see would match, with examples.

Nothing is changed on this page. Only users who manage or approve rules can open it.

## Business rule updated
The approved Bonafide rule (Qatar school → Medical University – Varna) is now **version 2**, adding *Nationality is India* from the MD's wording ("for an Indian national in a Qatar school"). Version 1 is retired and kept in the history.

## Technical
- Migration `0024_rule_engine.sql` (rollback in `db/rollbacks/`) adds:
  - `app.rule_facts`, `app.condition_eval` (immutable), `app.conditions_match` and `app.conditions_valid`, used as a CHECK constraint on every `conditions` column
  - the condition check in `applicable_rules`, `matching_attestation_routes`, `stage_requirement_issues`, `one_and_same_requirement` and `ensure_document_checklist_internal`
- TypeScript mirror: `src/lib/conditions.ts` (validation, plain-language description, trace). Editor: `src/components/condition-builder.tsx`.
- Tests:
  - `tests/integration/phase-4-rule-engine.test.ts`: database and explanation parity, invalid input, nationality-based Bonafide, conditional passport rule, conditional checklist, route versions, tester permissions
  - `tests/e2e/phase-4-rules.spec.ts`

## Not included
- Advisory country requirement notices keep their country, university and course scope; conditions can be added later.
- There is no separate "simulate a draft rule before approval" mode. Use the preview with the same condition.
