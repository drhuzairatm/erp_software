# Phase 9: Preferences and Admission Rules

**Status:** built and tested locally. Migration 0049 is applied to the local development database only. Nothing is committed, pushed or deployed.

## Gap analysis

| Need | Before | Decision |
|---|---|---|
| Primary preference | Working: destination, university, course and intake on the student record | Kept there, not duplicated |
| Secondary and tertiary preferences | Missing | New `student_preferences`, with history |
| Countries, universities, programmes, intakes | Working master data | Reused |
| Academic years | Missing | New `academic_years`: add, edit, activate, deactivate |
| Subject-wise academic rules | Working advisory notices with comparison | Reused. Added an optional intake, so a rule can be limited by programme, university and intake |
| University documents | Working `university_document_requirements` | Reused, and shown for each preference |
| Passport | Working: warning only, monitor, reminders, verified university rules | Not changed. The validity rules are shown for each preference |
| Country documents | Missing as a configurable rule | New `country_document_rules` with a verified status |

## What it does

- **Preferences panel** on the student's Overview tab. For each preference it shows subject-wise academic requirements compared with recorded marks, country documents, university documents and passport validity rules.
- **Advisory only:** nothing here blocks registration. The panel says so, and says requirements are not a guarantee of admission or a visa.
- **Nothing configured** shows as "No requirements are configured", with a note that this does not mean there are none.

## Rule verification

A country document rule starts unverified and inactive. The database refuses to make an unverified rule active. Only holders of `requirements.verify` (MD by default) can mark a rule verified, and they must say what the decision is based on. If someone without that permission edits a rule, it returns to unverified and inactive.

## Bulgaria

From the MD's brief of 5 Nov 2026, recorded as verified with that source:
- Bonafide Certificate.
- Police Clearance Certificate at the first visa stage, with the check that its issuing country must match the Visa Application Country. A mismatch shows a warning.
- Chemistry, Biology, Physics and English at 60%: the existing notice, unchanged.

**PCC timing guidance is empty.** The brief says it is configurable but gives no timing, so none was invented. It can be entered on the rule.

**Other countries have no rules.** None was invented.

## Please confirm

- **Bulgaria academic notice scope:** the existing notice applies to every programme in Bulgaria, not only Nursing and MBBS. It was left as it was. To narrow it, an administrator would create a version per programme.
- **First visa stage:** "appropriate visa stage" was taken as the first stage in the visa group, for the PCC rule.

## Database

Migration `0049_preferences_admission_rules.sql`, rollback tested with real rows. Four tables with RLS, one new permission and eight new functions. `app.student_advisories` now calls `app.student_advisories_for`, so a secondary choice is compared exactly as the primary is.

Rolling back removes the intake column, so a notice limited to one intake would become wider. Review notices before rolling back.

## Limits

- **Country document rules are shown, not added to the student's checklist.** A country document shows "not on the checklist yet" until staff add it. University requirements keep working through the checklist as before.
- **PCC match** needs the document's issuing country and the student's visa application country recorded. Until then it shows as not recorded.
- **University requirements with conditions** show "for some students": the panel does not evaluate those conditions against a secondary choice.
- **Students do not choose preferences in the portal.** Staff record them.
- **Academic year** on pre-admission requests stays free text, because a request is not a student record.
