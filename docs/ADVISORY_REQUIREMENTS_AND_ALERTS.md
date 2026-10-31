# Country-wise requirements (advisory) and the visual alert system

This replaces the Phase 3 "eligibility thresholds" (business change, Nov 2026).

## Country-wise requirements are advisory

**Admin → Country-wise requirements** (permission `requirements.manage`: System Administrator and MD).

Each requirement has:
- a country, plus an optional university or course
- a category: academic marks, age, subject prerequisites, language, entrance examination, document, nationality-specific or general
- a display category and a priority (below)
- notification title, message, requirement description and additional notes
- an effective date, an optional expiry date and a status (active or inactive)
- whether staff must acknowledge it

Academic-mark requirements list subjects with a minimum percentage or minimum marks, a qualification (Plus Two by default) and an optional grading system.

**Never blocking.** A notice is shown, compared with the student's recorded marks and can require acknowledgement, but:
- it never rejects a student or blocks registration or the application
- acknowledgement only records that a staff member has **seen** the notice (who, when, which version, and a snapshot of the comparison); it is not an eligibility decision
- at the configured stage (default University Application), a stage change shows a reminder to acknowledge, and staff can always continue
- the stage "academic check" can only be *none* or *warn*; "block" was removed

**Comparison statuses:**

| Status | Meaning |
|---|---|
| Academic marks meet configured requirements | every listed subject is at or above its minimum |
| Academic marks below configured requirements | at least one subject is below |
| Academic information missing | marks are not recorded |
| Manual review recommended | the grading system can't be compared, e.g. CGPA |
| Requirements acknowledged | shown with the name and time |

When an acknowledged notice shows below, missing or manual-review marks, an **"Academic verification" follow-up task** is created for the counsellor (once per notice version).

**Versions and history.**
- Editing creates a **new version**, and a reason is required.
- The history records the previous and new requirement, who changed it, when, why, and the effective date. Activation and deactivation are recorded too.
- Old versions and acknowledgements are kept; an acknowledgement always points to the version that was reviewed.
- A changed requirement must be acknowledged again ("an earlier version was acknowledged").
- The database refuses direct edits.

**Nothing is invented.** Only Bulgaria is configured (Chemistry, Biology, Physics and English at 60% or above, from the business brief). Other countries show no notice until an administrator adds one. Romania was added to the destination list.

The earlier `academic_thresholds` table is kept (no data is deleted) but switched off and unused. Its Bulgaria rows were converted into the notice.

## Visual alert system

| Colour | Label and icon | Used for |
|---|---|---|
| Red | **Critical** (octagon) | expired passport; passport expiring within 3 months; manager approval required; overdue high-priority tasks; critical alerts |
| Amber | **Warning** (triangle) | passport valid for less than 12 months; marks below requirements; missing academic information; pending verification; One and Same pending; mandatory notices and important warnings |
| Blue | **Information** (i) | additional points, general information, university-specific notes |
| Green | **Completed** (check) | acknowledged, approved, all clear |

Every alert shows a text label and an icon as well as the colour.

**Notice display categories:**

| Display category | Colour |
|---|---|
| Critical alert | red |
| Mandatory notice | amber, labelled "Mandatory notice" |
| Important warning | amber |
| Additional point | blue |
| General information | blue |

**Priority:** Critical and High notices are shown expanded; Normal and Informational are collapsed into one line with expandable details.

**Where alerts appear:**
- **Student profile:** a "Needs attention" panel under the header on every tab (passport, manager approvals, One and Same, documents pending verification, country notices with Acknowledge).
- **Student registration and edit form:** the selected destination's notices appear immediately.
- **Dashboard:** a "Priority attention" panel with critical counts and notices awaiting acknowledgement.
- **Reports:** "Notices awaiting acknowledgement" (managers see who still has to acknowledge).

**What still blocks:** only explicitly approved compliance rules block a stage.
- Today these are the **12-month passport validity rule** from University Application (MD instruction) and complete contact details from University Application.
- Colours and notices never block.

## Database

Migration `0021_advisory_notices.sql` (undo: `db/rollbacks/0021_advisory_notices.down.sql`).
- **Tables:** `advisory_notices` (versioned), `advisory_notice_items`, `advisory_notice_events` (append-only history) and `advisory_acknowledgements` (append-only).
- **Functions:** `app.save_advisory_notice`, `app.set_advisory_status`, `app.student_advisories` and `app.acknowledge_advisory`.
