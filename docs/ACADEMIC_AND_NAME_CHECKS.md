# Academic records, eligibility, name checks and One and Same (Phase 3)

## Academic tab (student profile)

| Course profile | Records offered first |
|---|---|
| Plus Two based (MBBS, Nursing, bachelor's) | Plus Two / Higher Secondary, Class 10, Bachelor's, Other |
| MBBS based (Postgraduate Medical) | MBBS degree, Internship, Medical registration (Plus Two and Class 10 optional) |

The profile is set per course: **Admin → Company settings → Courses → Academic details**.

**Each record holds:**
- the student's name exactly as printed
- certificate and register numbers
- board or university, school or institution, and its country
- certificate issuing country
- year of passing, stream and issue date
- internship dates (internship records) or medical council registration details (registration records)

**Grading systems:** percentage, marks (obtained / total), CGPA (10), GPA (4), letter grade and other.
- A percentage is taken from what is printed, or calculated from the marks.
- **CGPA and letter grades are never converted.** Thresholds then show "Check manually".

Subjects (Physics, Chemistry, Biology, Mathematics, English, other) can each have maximum marks, marks obtained, a percentage and a grade.

Who can do what:
- Staff who can edit the student can add or change records. Everyone who can see the student can read them.
- Another company cannot see them (enforced in the database).

## Eligibility thresholds (replaced Nov 2026)

> Superseded: academic mark requirements are now **advisory country-wise requirement notices** — see docs/ADVISORY_REQUIREMENTS_AND_ALERTS.md. The text below describes the original Phase 3 behaviour.

**Admin → Academic & name rules → Eligibility thresholds.**
- **Scope:** destination, university, course/programme, intake and grading system.
- **What is checked:** a qualification (Plus Two by default) and a subject, or the overall result.
- **Result shown:** Meets, Below threshold, Not recorded, or Check manually.

**Installed from the business brief:** Bulgaria, Plus Two — Chemistry, Biology, Physics and English each **60% or above**.

**Thresholds only flag results.** At the stages configured under "Academic check by stage" (default: **University Application = Warn**), moving a student forward shows these warnings to acknowledge:
- a missing Plus Two (or MBBS for postgraduate medical courses)
- results below a threshold

An administrator can switch a stage to **Block**. Nothing is checked earlier, so draft profiles can stay incomplete.

## Name checks

When the passport holder name (Passport tab) and a certificate name are both recorded, the database compares them. It reports:
- spelling differences
- initials instead of a full name
- missing surname or missing middle name
- different name order
- an extra name on the certificate
- spacing differences
- "other" (for example a completely different name)

Capitals, punctuation and extra spaces are ignored.

**Findings are warnings for human review and never invalidate a document.** Staff with `documents.review` can:
- record **"Same person – no document needed"** with a note (not allowed when a rule makes the One and Same document mandatory), or
- **require a One and Same** document.

Correcting the passport or certificate name re-runs the check.

## One and Same

**Rules** (Admin → Academic & name rules):
- **Scope:** destination, university, course/pathway, certificate type and type of difference.
- **Requirement:** **Recommended** or **Mandatory** (mandatory wins when several rules match). If no rule matches, the case is *Not required*, though staff may still require one.

**When the requirement is mandatory** (opened automatically):
- a required "One and Same Certificate / Affidavit" item is added to the document checklist
- a task goes to the documentation staff (or counsellor) and an information task to a manager

**Templates:**
- The administrator drafts the wording, using the placeholders `{{passport_name}} {{certificate_name}} {{document}} {{student_name}} {{date}}`.
- A **manager or the MD approves** it.
- Approved templates cannot be edited (the database refuses changes); retire them instead.

**Requesting and tracking:**
1. Staff choose an approved template.
2. **Generate preview** fills in the student's names.
3. **Request from student**, either:
   - by message (needs the "One and Same document requested" message rule switched on, with the student's consent), or
   - as a manual request with a note.
4. The student's document then goes through the normal review: verification, then mandatory manager approval.

**Statuses shown:** Recommended or Mandatory → Pending (requested) → Received (uploaded) → Verified → Approved.

A manager can cancel a requirement with a recorded reason.

**No real template wording has been supplied yet.** The demo has one approved "[TO CONFIRM]" template and two "[DEMO]" rules, for testing only.

## Bonafide wording supplied by the MD (installed as a draft)

| Field | Value |
|---|---|
| Rule | Bonafide – Indian student at a Qatar school → Medical University – Varna (Bulgaria) |
| Applies to | Bonafide certificate; previous education country Qatar; destination Bulgaria; university Medical University – Varna |
| Mandatory statement | "she/he is eligible to apply and continue her/his studies at various institutions and universities in India, Qatar as well as abroad" |
| Keywords (help locate it) | eligible, continue, studies, institutions, universities, India, Qatar, abroad |

The statement is a check staff confirm against the original; it isn't an exact-phrase match, because "her" and "his" vary. The rule is **draft**: the MD approves it under **Admin → Verification rules**. Nationality is not a rule condition yet; the rule is scoped by the Qatar school.

## Other configuration added in this phase

- Passport validity: **at least 12 months, warning only from University Application for all destinations, including when the expiry is missing** (MD decision, 4 Nov 2026). Only a verified university-specific rule may block (Passport & contact rules).
- Universities: **Medical University – Varna** and **Medical University – Pleven** (Bulgaria).
- Adding countries: "Used as" (destination, previous education country, or both).
- Adding courses: "Academic details" (Plus Two based or MBBS based).
- Students: optional **intake** (per university), used by thresholds.
- New document types: One and Same Certificate / Affidavit, MBBS Degree, Internship Completion Certificate, Medical Council Registration.

## Database

Migration `0020_academic_records.sql`; undo script `db/rollbacks/0020_academic_records.down.sql`.
- **New tables:** `academic_records`, `academic_subjects`, `academic_thresholds`, `name_checks`, `one_and_same_rules`, `one_and_same_templates` and `one_and_same_cases`.
- **New columns:** `courses.academic_profile`, `students.intake_id` and `stages.academic_check`.

For a demo database without a reset, add fictional academic data with `npm run demo:academic`.
