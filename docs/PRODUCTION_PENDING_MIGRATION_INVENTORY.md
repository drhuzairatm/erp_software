# Production Pending Migration Inventory

**Date:** 5 November 2026. **Handling: keep private, out of Git.** It contains no credentials or server details. **No migration was applied to Production or to the Development database, and nobody connected to the VPS.**

Companion: `docs/PRODUCTION_MIGRATION_EXECUTION_PLAN.md`. BC numbers refer to `docs/PRODUCTION_BREAKING_CHANGE_AUDIT.md`.

## 1. Result

- **Potentially pending: 14 files, 0038 to 0051, if the reported baseline is true.** If Production has fewer than the reported 37 applied, more are pending, and that number is unknown.
- **All 14 are mandatory for the current working-tree code.** New code on the old schema returned HTTP 500 on every staff page tested.
- **No migration file was found to need a code fix.** All 14 applied cleanly in order on a throwaway copy of the old system. Several still need a decision or a Production check before they run (section 6).
- **Nothing here proves what Production holds.** Its migration history has not been inspected.

## 2. Baseline: confirmed and reported

| Fact | Status | Source |
|---|---|---|
| Working tree holds 51 migration files and 35 rollback files (0017 to 0051) | **Confirmed** | Files |
| 37 files are tracked in Git; 14 (0038 to 0051) are untracked | **Confirmed** | `git` |
| Commits `f36328f`, `3df4171` and `eb8dd7d` each hold exactly 0001 to 0037, and files 0001 to 0037 match the working tree | **Confirmed** | `git diff` |
| `f36328f` is not an ancestor of `3df4171`. Each has commits the other lacks (1 and 8), though their migration files match | **Confirmed.** The earlier description "8 commits behind" was incomplete | `git rev-list` |
| Local `main` is not identical to `3df4171`, though it holds the same 37 migrations. GitHub was not checked | **Confirmed locally** | `git diff` |
| Development database: 50 applied (0001 to 0050), 0 unknown rows, 0 checksum mismatches; only 0051 not applied | **Confirmed**, read-only transaction | `schema_migrations` |
| Development PostgreSQL version 17.11 | **Confirmed** | Same |
| Development history is not a clean upgrade: 0047 was applied before 0046 during rework | **Confirmed** | Applied timestamps |
| Production runs `f36328f` | **Reported only** | `docs/audit/PRODUCTION_STATE_REPORT.md` |
| Production has 37 migrations applied | **Reported only** | Same |
| Production runs PostgreSQL 18 | **Reported only**. Never tested here | Same |
| Production's `schema_migrations` rows, checksums, roles, rules and row counts | **Unknown** | VPS access not authorised |

**Why numbers are not enough.** Having a file on the server does not prove it ran. 0037 entered Git on 3 Nov, and 0030 and 0033 to 0036 on 1 Nov, so a checkout could hold them while the database lacks them. The runner tracks exact filename and SHA-256, so 0037 can only be called applied if its row and checksum match Appendix A.

**How each outcome changes the list:**

| Production's real history | Pending |
|---|---|
| Exactly 0001 to 0037, all checksums match | These 14 |
| Some of 0001 to 0037 missing | Those files as well, first, in order. They have not been audited here and need review before running |
| A checksum differs | **The runner stops with an error and applies nothing.** Needs investigation; do not edit the file |
| Rows with no matching file | The runner ignores them, so someone must explain them first |
| Some of 0038 to 0051 already present | Fewer pending, but compare checksums; the files changed during development |

## 3. Groups

| Group | Migrations | Meaning |
|---|---|---|
| **A. Required for the existing ERP** | **0038**, plus any of 0001 to 0037 missing from Production | 0038 is a business rule change for the existing admissions flow and can run with the old app |
| **B. The 11 feature phases** | **0039 to 0050** | Phase 1: 0039, 0040. Phase 2: 0041. Phase 3: 0042. Phase 4: 0043. Phase 5: 0044. Phase 6: 0045, 0047. Phase 7: 0046. Phase 8: 0048. Phase 9: 0049. Phase 10: 0050. Phase 11 has no migration |
| **C. Student merge fix** | **0051** | Corrects BC-03 and BC-04. Not yet applied to Development either |
| **D. Optional or deferred** | **None, for the current code.** | If Production stays on the old code, all 14 can wait and nothing is forced; 0038 alone is then a separate business choice. `db:provision` is not a migration and is not needed for the app to run |
| **E. Must not be applied** | `docs/audit/proposed/0039_function_permissions.sql` and its rollback. Any Trust Boundary or `erp_system` SQL (none written) | See section 6 |

**Migrations cannot be picked individually for the new code.** The code uses objects from every file from 0039 to 0051. 0038 is the only file without dependents.

## 4. Measured upgrade rehearsal

This was an isolated test on a throwaway database, using fictional data on PostgreSQL 17.11. The old code built the 0037 baseline (37 students, 16 users, 120 tasks, 158 payment entries, 346 documents, 16 roles), and the 14 files then ran one at a time as the runner runs them. This is the first clean upgrade path tested from 0037 with data present. Earlier regressions used a fresh database or a reworked one.

| Check | Result |
|---|---|
| All 14 apply in order | **Yes.** About 0.1 s in total, which says nothing about Production timing |
| Table rewrites of existing tables | **None** |
| Student, employee, task, payment and document rows | **Unchanged**, compared by hash on baseline columns |
| Existing tables whose rows changed | `passport_validity_rules` (1 row updated), `permissions` (84 to 96), `role_permissions` (456 to 528), `audit_logs` (93 added), `security_alerts` (same count, contents changed) |
| New rows in new tables | 18 designations (9 for each of 2 organisations), 2 Bulgaria rules marked verified and active, 0 staff notifications |
| Full rollback 0051 to 0038 | All existing tables matched the baseline, except `audit_logs` (keeps growing) and `security_alerts` |
| Re-apply after that rollback | **Not run in this rehearsal** |

Rollback was tested with the new tables empty. It does not show what happens once staff have used the new modules.

**Old app `f36328f` on the schema including 0051, which had not been tested before:**

| Run | Result |
|---|---|
| Browser | 56 of 57. The one failure is the same test that fails in the control on schema 0037 |
| Backend, excluding the migrations test | 367 of 374 |
| Backend, full, with 0051 | 370 of 376 |
| Backend, full, control without 0051 | 361 of 376 |
| Scenario tests run alone | 12 of 12, with and without 0051 |

- **Failures in every run, all expected:** 3 tests pinning the old policy count (202 instead of 149) and 2 asserting the old passport block (MD decision, 0038).
- **Failures that came and went:** scenarios F, G and L, and 9 attestation tests. They appeared with and without 0051, and the most (15 in total) came in the control without it. This old suite runs several files against one shared database, which is the likely cause. I did not trace each one.
- **Gap:** no old-app test runs a student merge, so the old app's merge on the new function is checked by matching signature only.

## 5. Corrections to the earlier reports

- **BC-12 was wrong.** It said "Migrations alone do not add those rules". **0049 inserts the two Bulgaria rules itself**, marked verified and active, and 0041 inserts designations. The same applies to the compatibility matrix's Provisioning row. Those two reports have not been edited.
- **The earlier "new tables" framing understated security alerts.** Grants in migrations produced changes to `security_alerts`. On Production, expect new or updated "Role permission granted" alerts; this part is reasoned from the alert trigger.

## 6. Needs a fix, decision or check before running

No migration has a known defect in its SQL. These are the conditions, most serious first.

| Item | Affects | Issue | Needed |
|---|---|---|---|
| **Baseline unverified** | All 14 | Everything above assumes 37 applied with matching checksums | Read-only check, with your authorisation |
| **No PostgreSQL 18 run** | All 14 | Reported version never tested. No `create extension` or `concurrently` in these files, which lowers the risk but proves nothing | Rehearse on a restored copy on the same version |
| **Lock time unknown** | 0041, 0043 first; then 0048, 0049 | Full table locks; no `lock_timeout` in the runner. A long transaction could queue all staff requests behind the lock | Quiet window, a timeout plan, measured rehearsal |
| **Trust Boundary** | 0039 to 0051 | Rated High with Critical impact and postponed by you. These files add 50 tables and 168 new functions behind the same database identity, and they do not worsen the flaw itself. Not a schema blocker, but **a decision to accept before real staff data enters the new modules** | Your decision |
| **Bulgaria rules** | 0049 | Two rules arrive marked verified by the MD brief (BC-12) | Confirm they are correct, or plan to adjust them through the screen afterwards. Do not edit the file |
| **Passport rule list** | 0038 | Every matching Production rule becomes a warning at once, including any not in the repository (BC-05) | Review the list |
| **New data access** | 0040, 0042, 0044, 0045, 0046, 0048, 0049 | Existing roles gain permissions. Finance, Visa, Documentation and Counsellor can answer tickets (BC-10) | Your decision; compare Production roles |
| **Self-service names** | 0041 | Employees can change their displayed name (BC-11) | Your decision |
| **Legal notice** | 0042, 0047 | Attendance and chat oversight need a staff notice before use | Business and legal decision; feature exposure, not schema |
| **No virus scanner** | 0048 and all secure file modules | Uploads are labelled, not blocked | Accept, or install first |

**Must not be applied:**

- **`docs/audit/proposed/0039_function_permissions.sql`** is an unapproved draft outside the migration folder. Its number collides with the real 0039, and its list of 173 functions predates the new ones, so it would be incomplete. It would need rewriting and review.
- **Any Trust Boundary or `erp_system` SQL.** None exists, and that work stays postponed.

## 7. Each migration

Exact names were extracted from the SQL files. "Short write block" means reads continue and writes wait while the object is created. "Full lock" means reads and writes both wait. Locks were observed in the rehearsal; durations on Production are unknown. Every file runs in its own transaction, so a failure undoes that file only.

### 0038_passport_warning_only.sql

**Group A.** 16 lines. Rehearsal: 3 ms on fictional data (not predictive of Production).

- **Purpose:** Turns passport validity rules from blocking to warning only, by MD decision of 4 Nov 2026.
- **Tables:** no new tables.
- **Changes to earlier tables:** none.
- **Indexes:** none.
- **Triggers:** none.
- **RLS policies added:** 0.
- **SQL functions:** none.
- **Existing business records:** **Yes, rule settings only.** Every rule with `enforcement = block` that is global, or tied to a stage at or before Registration, becomes `warn`, and a note is appended. University-specific rules at later stages stay as they are. No student record changes.
- **Safety on real data:** Safe to run, but it changes business behaviour at once, also for the old app. It also changes any rule Production holds that is not in the repository, so the Production rule list must be reviewed first. Real-data behaviour remains unverified.
- **Depends on pending migrations:** none. All need the 37-migration baseline.
- **Code order:** Either side. The old app works with it (tested). It takes effect as soon as it commits.
- **Rollback and data loss:** Exact: the rollback restored the rule and its notes in the rehearsal. A rule set to `warn` by hand after 0038 needs checking, because the rollback targets the note 0038 wrote.
- **Locks and downtime:** Row locks on matching rules only. Table rewrites measured: 0.

### 0039_staff_notifications_secure_files.sql

**Group B, Phase 1.** 393 lines. Rehearsal: 6 ms on fictional data (not predictive of Production).

- **Purpose:** Staff notifications and secure file records.
- **Tables:** new tables: `staff_notifications`, `secure_files`.
- **Changes to earlier tables:** none.
- **Indexes:** `staff_notifications_dedupe` on `staff_notifications`, `staff_notifications_user_idx` on `staff_notifications`, `staff_notifications_unread_idx` on `staff_notifications`, `staff_notifications_email_idx` on `staff_notifications`, `secure_files_context_idx` on `secure_files`, `secure_files_rescan_idx` on `secure_files`.
- **Triggers:** `tasks_staff_notify` on `tasks`, `task_comments_staff_notify` on `task_comments`, `student_documents_staff_notify` on `student_documents`, `document_files_staff_notify` on `document_files`.
- **RLS policies added:** 2.
- **SQL functions:** 19 new: `authorize_secure_file_download`, `mark_staff_notifications_read`, `record_secure_file_scan`, `register_secure_file`, `remove_secure_file`, `secure_file_can_read`, `secure_file_can_write`, `secure_file_upload_org`, `secure_files_to_rescan`, `staff_notification_email_claim`, `staff_notification_email_finish`, `staff_notifications_daily`, `staff_notify`, `staff_notify_document`, `staff_notify_document_file_quarantined`, `staff_notify_task`, `staff_notify_task_comment`, `staff_org_for_student`, `student_document_approvers`.
- **Existing business records:** No existing rows change. **From this point, writes to tasks, task comments, student documents and document files also create staff notification rows through new triggers.**
- **Safety on real data:** Yes in the rehearsal. Notification errors are caught inside `staff_notify`, which protects the write but can hide a missing notification (BC-09). Notifications built up while the old app runs can be emailed once the new mail worker starts; entries older than 24 hours are skipped (BC-06). Real-data behaviour remains unverified.
- **Depends on pending migrations:** none. All need the 37-migration baseline.
- **Code order:** Before the new code. The new staff layout queries `staff_notifications` on every page.
- **Rollback and data loss:** Drops 2 tables and the triggers. Loses notifications and secure file records. Uploaded file bytes stay in storage, unreferenced.
- **Locks and downtime:** Short write block on `tasks`, `task_comments`, `student_documents`, `document_files` while each trigger is created, and on `organizations`, `user_profiles` for foreign keys. Table rewrites measured: 0.

### 0040_notifications_files_completion.sql

**Group B, Phase 1.** 315 lines. Rehearsal: 6 ms on fictional data (not predictive of Production).

- **Purpose:** Notification preferences, staff announcements, wider secure file rules and manual clearance fields.
- **Tables:** new tables: `staff_notification_preferences`, `staff_announcements`.
- **Changes to earlier tables:** `staff_notifications`: replaces `staff_notifications_event_key_check`, `staff_notifications_subject_type_check` | `secure_files`: adds columns `cleared_by`, `cleared_at`, `clear_reason`; replaces `secure_files_scan_status_check`, `secure_files_context_type_check`.
- **Indexes:** `staff_announcements_org_idx` on `staff_announcements`.
- **Triggers:** `staff_announcements_audit` on `staff_announcements`.
- **RLS policies added:** 2.
- **SQL functions:** 14 new: `clear_secure_file_manually`, `publish_announcement`, `secure_file_upload_download_history`, `set_my_notification_preference`, `sf_employee_org`, `sf_employee_read`, `sf_employee_write`, `sf_org`, `sf_student`, `sf_task_org`, `sf_task_read`, `sf_task_write`, `staff_notification_category`, `withdraw_announcement`; replaces from earlier pending files: `authorize_secure_file_download`, `record_secure_file_scan`, `register_secure_file`, `remove_secure_file`, `secure_file_can_read`, `secure_file_can_write`, `secure_file_upload_org`, `staff_notify`.
- **Existing business records:** No business records. Adds 1 permission and its role grants. Grants create audit rows and can create or update "Role permission granted" security alerts.
- **Safety on real data:** Yes in the rehearsal. Grants match roles by key, so a role missing or renamed on Production silently receives nothing. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0039.
- **Rollback and data loss:** Drops 2 tables. **Deletes secure file rows that are not task files**, and the added permissions.
- **Locks and downtime:** Short write block on `organizations`, `user_profiles`. Row inserts on permission tables. Table rewrites measured: 0.

### 0041_employee_profiles.sql

**Group B, Phase 2.** 140 lines. Rehearsal: 4 ms on fictional data (not predictive of Production).

- **Purpose:** Employee profile fields, designations, self-service profile update, `archived` staff status.
- **Tables:** new tables: `designations`.
- **Changes to earlier tables:** `user_profiles`: adds columns `first_name`, `middle_name`, `last_name`, `display_name`, `secondary_phone`, `additional_phone`, `address_line`, `city`, `state_region`, `postal_code`, `address_country`; replaces `user_profiles_account_status_check` | `organization_memberships`: adds columns `designation_id`.
- **Indexes:** `designations_org_name` on `designations`.
- **Triggers:** `user_profiles_display_name` on `user_profiles`, `designations_audit` on `designations`.
- **RLS policies added:** 3.
- **SQL functions:** 4 new: `set_staff_designation`, `staff_profile_history`, `update_my_profile`, `user_profiles_display_name`; **replaces existing:** `app.set_staff_status`.
- **Existing business records:** Existing employee rows keep their values; 11 new columns start empty. **Adds 9 reference designations to each existing organisation.** After it runs, the new `update_my_profile` function lets an employee change their own display name, which replaces `full_name` shown across the ERP (BC-11).
- **Safety on real data:** Yes in the rehearsal. The replaced status check is wider, so existing rows pass unless the constraint was changed by hand. Real-data behaviour remains unverified.
- **Depends on pending migrations:** none. All need the 37-migration baseline.
- **Code order:** Before the new code. Replaces `app.set_staff_status`; compare the Production definition first.
- **Rollback and data loss:** `archived` staff become `terminated` (that distinction is lost). Drops the new columns and designations, so profile details entered later are lost.
- **Locks and downtime:** **Highest impact: full lock on `user_profiles` and `organization_memberships`, including a scan to check the new constraint.** Staff requests read these tables constantly, so a wait here stops the whole app. Table rewrites measured: 0.

### 0042_attendance.sql

**Group B, Phase 3.** 538 lines. Rehearsal: 13 ms on fictional data (not predictive of Production).

- **Purpose:** Attendance: offices, policies, records, events, corrections, leaves, photo files.
- **Tables:** new tables: `attendance_offices`, `attendance_policies`, `attendance_records`, `attendance_events`, `attendance_qr_tokens`, `attendance_qr_uses`, `attendance_corrections`, `attendance_leaves`.
- **Changes to earlier tables:** `secure_files`: replaces `secure_files_context_type_check`.
- **Indexes:** `attendance_offices_org_name` on `attendance_offices`, `attendance_records_date` on `attendance_records`, `attendance_records_review` on `attendance_records`, `attendance_events_record` on `attendance_events`, `attendance_events_flagged` on `attendance_events`, `attendance_qr_tokens_expiry` on `attendance_qr_tokens`, `attendance_corrections_org` on `attendance_corrections`, `attendance_leaves_org` on `attendance_leaves`.
- **Triggers:** `attendance_records_touch` on `attendance_records`, `attendance_offices_audit` on `attendance_offices`, `attendance_policies_audit` on `attendance_policies`, `attendance_records_audit` on `attendance_records`, `attendance_corrections_audit` on `attendance_corrections`, `attendance_leaves_audit` on `attendance_leaves`.
- **RLS policies added:** 10.
- **SQL functions:** 17 new: `attendance_attach_photo`, `attendance_daily`, `attendance_decide_correction`, `attendance_decide_leave`, `attendance_decide_review`, `attendance_flag_event`, `attendance_issue_qr`, `attendance_mark`, `attendance_notify_reviewers`, `attendance_office_settings`, `attendance_request_correction`, `attendance_request_leave`, `attendance_set_status`, `distance_m`, `sf_attendance_org`, `sf_attendance_read`, `sf_attendance_write`; replaces from earlier pending files: `secure_file_can_read`, `secure_file_can_write`, `sf_org`.
- **Existing business records:** No existing rows change. Adds 3 permissions and role grants.
- **Safety on real data:** Yes in the rehearsal. Staff use needs the attendance legal notice decision, which affects the feature rather than the migration. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0039 and 0040.
- **Rollback and data loss:** Drops 8 tables and loses all attendance history. Photos stay in storage.
- **Locks and downtime:** Short write block on `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0043_task_lifecycle.sql

**Group B, Phase 4.** 233 lines. Rehearsal: 8 ms on fictional data (not predictive of Production).

- **Purpose:** Task lifecycle: `submitted` status, deadline with time, extensions, reviews, reminder settings.
- **Tables:** new tables: `task_deadline_extensions`, `task_reviews`, `task_reminder_settings`.
- **Changes to earlier tables:** `tasks`: adds columns `due_at`, `start_date`, `completion_instructions`, `evidence_required`, `requires_review`, `progress_percent`, `assigned_at`, `assigned_by`, `original_due_at`, `original_due_date`, `overdue_at`, `completed_late`, `submitted_at`, `submitted_by`, `correction_count`; replaces `tasks_status_check`.
- **Indexes:** `tasks_open_deadline_idx` on `tasks`, `task_deadline_extensions_task` on `task_deadline_extensions`, `task_reviews_task` on `task_reviews`.
- **Triggers:** `task_reminder_settings_audit` on `task_reminder_settings`, `tasks_lifecycle_before` on `tasks`.
- **RLS policies added:** 5.
- **SQL functions:** 7 new: `task_can_review`, `task_deadline`, `task_extend`, `task_reminders_tick`, `task_review`, `task_submit`, `tasks_lifecycle_before`.
- **Existing business records:** Existing task rows keep their values. New columns use constant defaults or stay empty; the rehearsal confirmed no table rewrite. **A new trigger runs on every task insert and update from now on.** The new scheduler's first run marks open tasks overdue from the last 3 days and adds events (BC-13).
- **Safety on real data:** Yes in the rehearsal. Old-app task writes also passed. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040. All need the 37-migration baseline.
- **Code order:** Before the new code. Task pages select `due_at`.
- **Rollback and data loss:** `submitted` tasks become `in_progress`. Drops 3 tables and all added columns, so reviews, extensions and exact deadlines are lost.
- **Locks and downtime:** **High impact: full lock on `tasks`, a scan for the check, and a non-concurrent index build (`tasks_open_deadline_idx`).** Duration grows with the number of tasks. Table rewrites measured: 0.

### 0044_meetings.sql

**Group B, Phase 5.** 293 lines. Rehearsal: 9 ms on fictional data (not predictive of Production).

- **Purpose:** Meetings, attendees, minutes, decisions, action points, core team.
- **Tables:** new tables: `core_team_members`, `meetings`, `meeting_attendees`, `meeting_minutes`, `meeting_minutes_versions`, `meeting_decisions`, `meeting_action_points`.
- **Changes to earlier tables:** `secure_files`: replaces `secure_files_context_type_check`.
- **Indexes:** `meetings_org_date` on `meetings`, `meeting_attendees_user` on `meeting_attendees`, `meeting_decisions_meeting` on `meeting_decisions`, `meeting_action_points_meeting` on `meeting_action_points`.
- **Triggers:** `meetings_touch` on `meetings`, `meetings_audit` on `meetings`, `core_team_members_audit` on `core_team_members`, `meeting_decisions_audit` on `meeting_decisions`, `meeting_action_points_audit` on `meeting_action_points`.
- **RLS policies added:** 7.
- **SQL functions:** 13 new: `add_meeting_action`, `add_meeting_decision`, `cancel_meeting`, `is_core_team`, `meeting_action_to_task`, `meeting_can_edit`, `meeting_can_read`, `meeting_set_attendees`, `meetings_daily`, `save_meeting`, `save_meeting_minutes`, `set_core_team_member`, `sf_meeting_org`; replaces from earlier pending files: `secure_file_can_read`, `secure_file_can_write`, `sf_org`.
- **Existing business records:** No existing rows change. Adds 1 permission and role grants.
- **Safety on real data:** Yes in the rehearsal. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040, 0042. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0039, 0040, 0042 and references `tasks`.
- **Rollback and data loss:** Drops 7 tables and loses all meeting records.
- **Locks and downtime:** Short write block on `tasks`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0045_internal_chat.sql

**Group B, Phase 6.** 330 lines. Rehearsal: 9 ms on fictional data (not predictive of Production).

- **Purpose:** Internal chat: conversations, members, messages, reactions, presence, history.
- **Tables:** new tables: `chat_conversations`, `chat_members`, `chat_messages`, `chat_reactions`, `chat_message_history`, `chat_presence`.
- **Changes to earlier tables:** `secure_files`: replaces `secure_files_context_type_check`.
- **Indexes:** `chat_conversations_direct` on `chat_conversations`, `chat_members_user` on `chat_members`, `chat_messages_conv` on `chat_messages`, `chat_messages_search` on `chat_messages`.
- **Triggers:** `chat_conversations_audit` on `chat_conversations`.
- **RLS policies added:** 5.
- **SQL functions:** 18 new: `chat_add_member`, `chat_create_group`, `chat_delete`, `chat_edit`, `chat_heartbeat`, `chat_is_admin`, `chat_is_member`, `chat_notify`, `chat_open_direct`, `chat_pin`, `chat_react`, `chat_send`, `chat_set_member`, `chat_shares_company`, `chat_sync_group`, `sf_chat_org`, `sf_chat_read`, `sf_chat_write`; replaces from earlier pending files: `secure_file_can_read`, `secure_file_can_write`, `sf_org`.
- **Existing business records:** No existing rows change. Adds 1 permission and role grants.
- **Safety on real data:** Yes in the rehearsal. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040, 0042, 0044. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs earlier secure file migrations. `/api/chat/sync` needs the new API.
- **Rollback and data loss:** Drops 6 tables and loses all chat history.
- **Locks and downtime:** Short write block on `tasks`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0046_pre_admission_dvr.sql

**Group B, Phase 7.** 493 lines. Rehearsal: 11 ms on fictional data (not predictive of Production).

- **Purpose:** Pre-admission DVR requests, documents, reviews, field changes, events.
- **Tables:** new tables: `dvr_counters`, `dvr_requests`, `dvr_documents`, `dvr_document_reviews`, `dvr_events`, `dvr_field_changes`.
- **Changes to earlier tables:** `secure_files`: replaces `secure_files_context_type_check`.
- **Indexes:** `dvr_requests_queue` on `dvr_requests`, `dvr_requests_counsellor` on `dvr_requests`, `dvr_requests_student` on `dvr_requests`, `dvr_documents_request` on `dvr_documents`, `dvr_document_reviews_doc` on `dvr_document_reviews`, `dvr_events_request` on `dvr_events`.
- **Triggers:** `dvr_requests_touch` on `dvr_requests`, `secure_files_dvr_version` on `secure_files`.
- **RLS policies added:** 5.
- **SQL functions:** 27 new: `dvr_add_document`, `dvr_assign`, `dvr_can_change_documents`, `dvr_can_read`, `dvr_check`, `dvr_close`, `dvr_complete`, `dvr_create`, `dvr_is_owner`, `dvr_is_reviewer`, `dvr_link_student`, `dvr_log`, `dvr_notify`, `dvr_notify_reviewers`, `dvr_on_file`, `dvr_remove_document`, `dvr_request_document`, `dvr_return`, `dvr_review_document`, `dvr_reviewers`, `dvr_send_back`, `dvr_start`, `dvr_submit`, `dvr_update`, `sf_dvr_org`, `sf_dvr_read`, `sf_dvr_write`; replaces from earlier pending files: `remove_secure_file`, `secure_file_can_read`, `secure_file_can_write`, `sf_org`.
- **Existing business records:** No existing rows change. Adds 3 permissions and role grants. New requests can later link to students.
- **Safety on real data:** Yes in the rehearsal. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040, 0042, 0044, 0045. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0039, 0040, and earlier secure file migrations.
- **Rollback and data loss:** Drops 6 tables and loses DVR records. Students already linked or created stay.
- **Locks and downtime:** Short write block on `students`, `countries`, `courses`, `universities`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0047_chat_governance.sql

**Group B, Phase 6.** 357 lines. Rehearsal: 9 ms on fictional data (not predictive of Production).

- **Purpose:** Chat governance: retention, legal holds, oversight requests, delegates, access log.
- **Tables:** new tables: `chatgov_retention_policies`, `chatgov_retention_runs`, `chatgov_delegates`, `chatgov_holds`, `chatgov_requests`, `chatgov_access_log`.
- **Changes to earlier tables:** `chat_message_history`: replaces `chat_message_history_action_check`.
- **Indexes:** `chat_message_history_message` on `chat_message_history`, `chatgov_delegates_active` on `chatgov_delegates`, `chatgov_access_log_request` on `chatgov_access_log`.
- **Triggers:** `chatgov_access_log_locked` on `chatgov_access_log`, `chatgov_runs_locked` on `chatgov_retention_runs`, `chatgov_requests_keep` on `chatgov_requests`, `chatgov_holds_keep` on `chatgov_holds`, `chatgov_delegates_keep` on `chatgov_delegates`, `chat_message_history_guard` on `chat_message_history`.
- **RLS policies added:** 6.
- **SQL functions:** 20 new: `chatgov_archive_guard`, `chatgov_can_view`, `chatgov_close`, `chatgov_decide`, `chatgov_direct_of`, `chatgov_groups`, `chatgov_has`, `chatgov_held`, `chatgov_is_md`, `chatgov_no_change`, `chatgov_no_delete`, `chatgov_notify`, `chatgov_place_hold`, `chatgov_read`, `chatgov_release_hold`, `chatgov_request`, `chatgov_retention_tick`, `chatgov_set_delegate`, `chatgov_set_retention`, `chatgov_user_has`.
- **Existing business records:** Only chat tables from 0045 are altered, which hold nothing at first. No existing business rows change.
- **Safety on real data:** Yes in the rehearsal. Using oversight features needs the legal notice decision. The development database applied 0047 before 0046 during rework, so this order is confirmed by the clean rehearsal, not by development history. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0045. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0045.
- **Rollback and data loss:** Drops 6 tables and loses holds and access logs. `retention_archived` becomes `deleted` in chat history.
- **Locks and downtime:** Short write block on `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0048_student_tickets.sql

**Group B, Phase 8.** 323 lines. Rehearsal: 8 ms on fictional data (not predictive of Production).

- **Purpose:** Student tickets, messages, events and attachments; `ticket` portal notices.
- **Tables:** new tables: `student_ticket_counters`, `student_tickets`, `student_ticket_messages`, `student_ticket_events`.
- **Changes to earlier tables:** `secure_files`: replaces `secure_files_context_type_check`; adds constraints `secure_files_uploader_check`; alter column uploaded_by drop not null | `portal_notices`: replaces `portal_notices_kind_check`.
- **Indexes:** `student_tickets_queue` on `student_tickets`, `student_tickets_student` on `student_tickets`, `student_tickets_assignee` on `student_tickets`, `student_ticket_messages_ticket` on `student_ticket_messages`, `student_ticket_events_ticket` on `student_ticket_events`.
- **Triggers:** `student_tickets_touch` on `student_tickets`.
- **RLS policies added:** 3.
- **SQL functions:** 19 new: `portal_ticket`, `portal_ticket_create`, `portal_ticket_file`, `portal_ticket_register_file`, `portal_ticket_reply`, `portal_ticket_upload_target`, `portal_tickets`, `sf_ticket_org`, `sf_ticket_read`, `sf_ticket_write`, `ticket_assign`, `ticket_can_manage`, `ticket_can_read`, `ticket_log`, `ticket_notify_staff`, `ticket_reply`, `ticket_set_status`, `ticket_staff`, `ticket_student`; replaces from earlier pending files: `remove_secure_file`, `secure_file_can_read`, `secure_file_can_write`, `sf_org`.
- **Existing business records:** Existing portal notices keep their values. Adds 2 permissions and role grants. **Finance, Visa, Documentation and Counsellor roles gain access to answer questions from students they can see** (BC-10). `secure_files.uploaded_by` becomes optional for portal uploads.
- **Safety on real data:** Yes in the rehearsal. Student uploads have no virus scanner yet; they are labelled, not blocked. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039, 0040, 0042, 0044, 0045, 0046. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs earlier secure file migrations and 0046.
- **Rollback and data loss:** Drops 4 tables and removes `ticket` notices, so all ticket conversations are lost.
- **Locks and downtime:** **Full lock on `portal_notices` with a scan.** Short write block on `students`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0049_preferences_admission_rules.sql

**Group B, Phase 9.** 303 lines. Rehearsal: 9 ms on fictional data (not predictive of Production).

- **Purpose:** Academic years, student preferences and history, country document rules, advisory notices by intake.
- **Tables:** new tables: `academic_years`, `student_preferences`, `student_preference_history`, `country_document_rules`.
- **Changes to earlier tables:** `advisory_notices`: adds columns `intake_id`.
- **Indexes:** `student_preference_history_student` on `student_preference_history`, `country_document_rules_key` on `country_document_rules`.
- **Triggers:** `academic_years_audit` on `academic_years`, `country_document_rules_touch` on `country_document_rules`, `country_document_rules_audit` on `country_document_rules`.
- **RLS policies added:** 4.
- **SQL functions:** 8 new: `save_academic_year`, `save_country_document_rule`, `set_country_document_rule_active`, `student_advisories_for`, `student_preference_clear`, `student_preference_requirements`, `student_preference_save`, `verify_country_document_rule`; **replaces existing:** `app.save_advisory_notice`, `app.student_advisories`.
- **Existing business records:** No student rows change. **Inserts 2 Bulgaria rules (Bonafide Certificate, Police Clearance) already marked verified and active, if Bulgaria and those document types exist.** Adds 1 permission and role grants. New `intake_id` on advisories starts empty.
- **Safety on real data:** Yes in the rehearsal. Replaces `save_advisory_notice` and `student_advisories`, so compare their Production definitions. The Bulgaria rules were checked as a listing only; this audit did not find them changing any student's requirements automatically. Real-data behaviour remains unverified.
- **Depends on pending migrations:** none. All need the 37-migration baseline.
- **Code order:** Before the new code. Independent of the other pending files, except that 0051 needs it.
- **Rollback and data loss:** Drops 4 tables and loses preferences and rules. Advisories lose the intake link.
- **Locks and downtime:** **Full lock on `advisory_notices`.** Short write block on `students`, `countries`, `courses`, `universities`, `university_intakes`, `stages`, `document_types`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0050_finance_due_dates.sql

**Group B, Phase 10.** 102 lines. Rehearsal: 4 ms on fictional data (not predictive of Production).

- **Purpose:** Payment due dates and the `payment_due_status` view.
- **Tables:** new tables: `payment_due_dates`; new or replaced views: `payment_due_status`.
- **Changes to earlier tables:** none.
- **Indexes:** `payment_due_dates_date` on `payment_due_dates`, `payment_due_dates_student` on `payment_due_dates`.
- **Triggers:** none.
- **RLS policies added:** 1.
- **SQL functions:** 2 new: `payment_due_reminders`, `set_payment_due_date`.
- **Existing business records:** **No ledger change.** Existing charges and payments are only referenced.
- **Safety on real data:** Yes in the rehearsal. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0039. All need the 37-migration baseline.
- **Code order:** Before the new code. The students and finance pages read the view.
- **Rollback and data loss:** Drops the table and view, so entered due dates are lost. Ledger untouched.
- **Locks and downtime:** Short write block on `payment_entries`, `students`, `organizations`, `user_profiles`. Table rewrites measured: 0.

### 0051_student_merge_related_records.sql

**Group C.** 222 lines. Rehearsal: 2 ms on fictional data (not predictive of Production).

- **Purpose:** Student merge fix (BC-03, BC-04): merge moves due dates, tickets, DVR links and preferences correctly, and a fully paid charge stays fully paid.
- **Tables:** new or replaced views: `payment_due_status`.
- **Changes to earlier tables:** `payment_due_dates`: adds columns `settled_on_merge` | `student_preference_history`: adds columns `note`; replaces `student_preference_history_action_check`.
- **Indexes:** none.
- **Triggers:** none.
- **RLS policies added:** 0.
- **SQL functions:** **replaces existing:** `app.merge_students`; replaces from earlier pending files: `dvr_link_student`.
- **Existing business records:** Pending tables only: adds a column to `payment_due_dates` and `student_preference_history`, and repairs due dates whose student differs from the charge's student. On a first deployment those tables are new, so there is nothing to repair. **No existing student or ledger row is touched by the migration.** Future merges behave differently.
- **Safety on real data:** Yes in the rehearsal, and in the new tests on fictional data. The old app's merge calls the same function signature, but **no test runs the old app's merge on the new function**. Real-data behaviour remains unverified.
- **Depends on pending migrations:** 0046, 0048, 0049, 0050. All need the 37-migration baseline.
- **Code order:** Before the new code. Needs 0046, 0048, 0049, 0050. Do not ship the working tree's 0050 stage without it, or BC-03 and BC-04 return.
- **Rollback and data loss:** Records already moved stay on the surviving student. Settled amounts are lost, and paid due dates may then show as unpaid. `merged_*` history rows are deleted. `merge_students` returns to its previous definition.
- **Locks and downtime:** No strong lock on any table that exists at baseline. Table rewrites measured: 0.

## Appendix A. Checksums for comparison

Compare every row with Production's `public.schema_migrations`, by exact filename and checksum. These are SHA-256 values of the current files, the same calculation the runner uses.

| File | SHA-256 |
|---|---|
| `0001_foundation.sql` | `ada114ad1361ac92333a85d2ef1bb6eaf4121766b40e1b354dc56776b380d955` |
| `0002_reference_and_workflow.sql` | `a99ccb1d16012c99dbf909bffac6056ea5f5b1f791ff3866c101d3839f1cd47e` |
| `0003_students.sql` | `6db6ca3da1fb3117fec9faed880e4af086022dea242ee584fdf6f86d663a38ad` |
| `0004_documents.sql` | `f4c77be927fb28b374c45bdd0e95593ac6e39d201412b436fa70fa373559e72c` |
| `0005_tasks.sql` | `b5f310de99ae7610f064699c34eee070bb564c93d1ba7b6066030110fff74aae` |
| `0006_payments.sql` | `ff004b353a55c5a59a209a3c513b9d7a70a38a6a52c95a7e627a24af671a7211` |
| `0007_security.sql` | `f106e68a730fb53bcd7e0c7e2cc9dcff0be0cb0611f885a57a3c743cbea842a7` |
| `0008_system_data.sql` | `42f9aa318a3e27388fb964946975eb4fbf34a744f62d5f0c793a0729c0120119` |
| `0009_admin_helpers.sql` | `9c5729cabd33c6c70bcbcc7ab6c08622751d4f18b3c8e2ab73df410d89f0cda7` |
| `0010_platform_hardening.sql` | `a616f3c00b17d9c0095061e43a7528ef8b155471967ab6b8fd463df238b2d92b` |
| `0011_student_import.sql` | `74b7fe40b7f3f8367cc3af83ca6c943ba70cfb84678102add64c95598173e172` |
| `0012_roles_mfa_departments.sql` | `56ec6a7b07275dd18f34ae01bc4d0920d8f66af4fd6e6ee42d4fd20669c2a231` |
| `0013_students_universities.sql` | `873114584cb516a60dd6963925092d7dd0c02e628a6474b8aeda19d242a5bf72` |
| `0014_document_verification.sql` | `1507f4911cbe1069bb6952378fc914304d14861d4da083c444f6c16abc4b2f9a` |
| `0015_notifications.sql` | `77b41a36f522d045f097b465051402d320fafe1f39e0ca6137bdd0d311f02733` |
| `0016_student_portal.sql` | `3568fbfb393372f9dfa8816d009b8188e234a56db091f52f0fe6fb194a53f75c` |
| `0017_country_tajikistan.sql` | `4ef95d169125153c21d0df196a536592bb1703c9d25fd9fbc6787fa4a3c98351` |
| `0018_attestation_engine.sql` | `a72840c9d8b7f577c806c71804bdf5c0c8e65ef9555b0e6e9c7f8ce44f3268b3` |
| `0019_passport_contacts.sql` | `0a6cb6c67b571debaa4c3e80af54c912b90bb6cd9db4324aef81a68f07387ec5` |
| `0020_academic_records.sql` | `6532c12be25f1b408e25966fa4af3089f0835477e86f89e01370ae125cccdc11` |
| `0021_advisory_notices.sql` | `47abda4217421eb0d0c8d5c3596590ecfcea38f7623a4fae31edb4321261e3e2` |
| `0022_passport_verification.sql` | `b8c549865a3e0f29d8f1cdb0e5383bb5e5b8af07f4fd77ba7cf61c6e5393b510` |
| `0023_courier_originals.sql` | `d5148fab510fc2ebff2d314515715497cdf927b058f81690b2f06a43f59c7f58` |
| `0024_rule_engine.sql` | `d63ea2694ec7a53564de9759cee04254295d9c1b182361930a08a1ba606e2170` |
| `0025_portal_v2.sql` | `32a63d8702293ff7a85c682ee9489e747864c78a43dcca0c8f9c00a5dee70d48` |
| `0026_leads_referrals.sql` | `df6488b35f65ac7c7cda4ecf84b92733cedf91bad341446f5651341ef85d6cf3` |
| `0027_student_photos.sql` | `1bfc44b2501c982c23b8d246e166a215be7a703c3d39ec7830ab9d5e78187541` |
| `0028_multi_currency.sql` | `0d7a1bea42a74920bf530912922552ff15800ef81d5366cb5eb1993ac65b2c61` |
| `0029_document_merges.sql` | `6aa4a65e56f0707e83ab92f80010c077a0f549c2e7e5d0e07954a156bec29f94` |
| `0030_staff_profiles_roles.sql` | `7418d77f56234646886fe5a459033bba636b61730e67ff12e7d1a046f64be140` |
| `0031_master_data.sql` | `7cb82ae2684195c465678b435a35dd0d0fb95aa7a2d95023b77a01370808dad9` |
| `0032_staff_accounts.sql` | `2618950f3acc673f3f7deac36b003060eb61e4985d0e312a8ecf87640c678f2c` |
| `0033_security_phase_b.sql` | `1efc37c786c8ccfc5aa6c45952815c9d892b02bd2d0f1dd7c59021c19fdf4a5d` |
| `0034_audit_remediation.sql` | `e545242b759329a76dd5fa8f462dd337ca8393c5b94362b712936af0f6901139` |
| `0035_auth_rate_limits.sql` | `c852ae8452745b508d084b0969d4da615a3be1a560e7ff265a44e65c17ad60c3` |
| `0036_portal_link_queue.sql` | `4f374d8cee58c2e23b70fc3e9ab4888ed0d93e60b199872a5f1b620a9819cad0` |
| `0037_auth_message_queue.sql` | `71af836170893fda8a5a306ffee58e14d2a199ea155c537714689ab4684c362c` |
| `0038_passport_warning_only.sql` | `a5e8fb5e5d340b64f004ebb1aedaabdbd12955cf106c4e7689aa97c8f71e78be` |
| `0039_staff_notifications_secure_files.sql` | `c353b4a54d051265619a39822f56cd6fe7bb73bf8858a8e50d10a1ab7e4581d5` |
| `0040_notifications_files_completion.sql` | `a7e0575fd5abc496eda785bac6031de0ca6fa1e8952941d117b2cb22a2bc706d` |
| `0041_employee_profiles.sql` | `398dcff370e9f9d7fa73d2af61e7332db801895cfd2363d5764070f372c9298a` |
| `0042_attendance.sql` | `3b751ea3541adb8f6ed9303b66a8fbd4d1628cc2a1f02421ead624de02c05411` |
| `0043_task_lifecycle.sql` | `883e902c2e73a4e9a4e748f2f5287325723432d7e62c1e5afc7317a001c40693` |
| `0044_meetings.sql` | `3e40a22e8c346a5eda971575ad3124c734544ed0cc7c0ea7f3d975e5d82eba63` |
| `0045_internal_chat.sql` | `f107d181c59287ec10dd3a746a98989be9a75ade396c93ab146eb2823b0d0841` |
| `0046_pre_admission_dvr.sql` | `08dc3d0724c3e1ddb779c01e691f3b69f6bb98b1d3e49f731900325a9e6f30da` |
| `0047_chat_governance.sql` | `6f4747fbc93747aa0a46cdeb1f136e18ca375bbb51dc5103eff589cc5f51321b` |
| `0048_student_tickets.sql` | `e222fe82ae251d784626196d77b30e86d37564a6cc9a1470a51845ab710287bb` |
| `0049_preferences_admission_rules.sql` | `474e2eef2b8588dfbe2aee48a8c0e47666324a50ed8218483e5c7b353a064973` |
| `0050_finance_due_dates.sql` | `d31908eefe22e4cf506c57d2a065927e076f58b57e3f3450d363523c3021aac9` |
| `0051_student_merge_related_records.sql` | `258e00d5752195a7ee243f9541499db8c45c8b3037f67ea3eaaccb1b34dbcade` |
