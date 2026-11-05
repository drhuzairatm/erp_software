# Privileged database functions: security review

**Date:** 4 November 2026
**Scope:** local development database and source at the clean-up branch. **Production was not inspected**, and its permissions may differ.
**Status:** report only, for MD decision. **No permission has been changed.**
**Method:** read-only catalogue queries, a read-only probe as `erp_app` that returned counts only, and call-site review.

## 1. Result

> **Severity corrected, 4 Nov 2026.** The "Medium" below applied only to the PUBLIC grants. The related `erp_app` risk is **High, with Critical impact**: see `ERP_APP_TRUST_BOUNDARY_REVIEW.md`. Stage A and B evidence is in `STAGE_A_B_PERMISSION_PROPOSAL.md`.

The PUBLIC grants are real. My readiness report said any database role could run them, but no other role can reach them today, because `USAGE` on schema `app` is held only by `postgres` and `erp_app`.

| Question | Answer |
|---|---|
| Is there a path for a user of the app to exploit this? | **None found, not proven absent.** All 7 `.unsafe` uses and all 15 unguarded call sites were reviewed. This was not a penetration test |
| Can a role with no grants run them? | **No.** Tested: `permission denied for schema app` |
| Does the risk grow later? | **Yes.** Any future role given `USAGE` on `app` (monitoring, reporting) would immediately get all 173, including session creation |
| Can they bypass company isolation? | **Yes, for anyone who can run raw SQL as `erp_app`.** Confirmed below |
| Severity of the PUBLIC grants alone | **Medium.** The `erp_app` risk is rated separately as High |

## 2. Facts

| Item | Count |
|---|---|
| Functions in `app` | 291 |
| SECURITY DEFINER | **263**, all owned by superuser `postgres`, so they bypass RLS |
| Fixed `search_path` | 263 of 263 |
| Dynamic SQL found by pattern search | 0 |
| Executable by PUBLIC | **173** (140 of them also granted to `erp_app`) |
| `erp_app` only | 56 |
| Owner only | 34 |
| Login roles | `postgres`, `erp_app` |

**Root cause:** `0010_platform_hardening.sql:27-28` runs `alter default privileges in schema ... revoke execute ... from public`. PostgreSQL can't remove the built-in PUBLIC grant per schema, so it did nothing: `pg_default_acl` has no rows. Each function created since then is PUBLIC unless revoked individually.

## 3. Isolation probe

Run read-only as `erp_app`, signed in as a counsellor from one company, against a student of the other company. Only row counts were read.

| Call | Rows | Meaning |
|---|---|---|
| `students` table | 0 | **RLS holds** |
| `rule_facts(student)` | 1 | Crosses companies |
| `stage_requirement_issues(student, stage)` | 3 | Crosses companies; messages can include passport expiry |
| `notification_context(message)` | 1 | Crosses companies; includes student name and code |
| `auth_login_lookup(email)` | 1 | Returns a password hash to a signed-in context (hash not read) |
| `security_alerts_to_email()` | Refused | The guard works |
| `students` after setting `app.user_id` to the MD | 1 | **See below** |

**A wider limit:** anyone with raw SQL as `erp_app` can set `app.user_id` to any user and pass RLS. So RLS depends on the application server being trusted, and tightening function permissions doesn't protect a stolen `erp_app` password. That password should be treated as a top-level secret.

## 4. Which functions need access

"Needs `erp_app`" means the function is called from application code, or from an RLS policy, view, check, default or non-privileged function, all of which run as the caller. Functions called only inside other privileged functions, and trigger functions, don't need a direct grant.

| Group | Count | Proposed change |
|---|---|---|
| PUBLIC, needs `erp_app` | 128 | Revoke PUBLIC; `erp_app` keeps its existing explicit grant (all 128 already have one) |
| PUBLIC, trigger functions | 25 | Revoke PUBLIC |
| PUBLIC, internal only | 20 | Revoke PUBLIC and any `erp_app` grant |
| `erp_app` only, internal only | 7 | Revoke `erp_app` |

**Most sensitive of those no longer directly callable:** `auth_create_session` (can create a session for any user), `auth_login_lookup` and `portal_password_candidates` (return password hashes), `auth_complete_reset`, `portal_set_password`, `raise_security_alert`.

**Needing PUBLIC itself:** none. Sign-in, portal and referral flows all run through the server as `erp_app`.

## 5. Proposed fix, in stages (not started)

Each stage is one migration with a rollback and a before-and-after permission comparison.

| Stage | Change | Risk | Benefit |
|---|---|---|---|
| **A** | Global `alter default privileges for role postgres revoke execute on functions from public`, so new functions stop inheriting it | Very low | Stops the problem growing; needed before Phase 1 adds functions |
| **B** | Revoke PUBLIC from all 173. `erp_app` keeps its existing grants, and no new ones are needed | Low to medium: a missed dependency fails a feature, so the full regression must pass | Closes the latent risk from future roles |
| **C** | Remove `erp_app` from the 27 internal-only functions | Medium: confirm none is called directly, and some tests call them | Removes session creation and password-hash lookups from direct reach |
| **D** | Add "system job only" guards to `claim_notifications`, `finish_notification`, `notification_context`, `enqueue_notification`, `passport_monitor`, `passport_close_tasks`, `expire_email_verifications`, `raise_security_alert`, `refresh_name_checks`, `portal_notify`, and sign-in functions that return hashes | Medium: changes function bodies | Matches the newer queues |
| **E (later)** | Consider a test failing whenever a function is PUBLIC | Low | Prevents regressions |

**Recommendation:** approve **A and B** first, and decide on C and D after they pass. Functions that take a student or document ID and cross companies should stay callable, because screens use them after an RLS-protected check. I'd review adding row checks to them separately.

**What this review can't confirm:**
- The dependency list comes from a pattern search and catalogue text, so the regression run is the real proof.
- Production may differ.
- "Internal only" functions used in tests: `auth_create_session`, `auth_login_lookup`, `auth_mask_error`, `auth_record_attempt`, `auth_secret_cipher_ok`, `portal_device_valid`, `portal_link_cipher_ok`, `portal_password_candidates`, `portal_password_result`, `portal_student`, `raise_security_alert`, `staff_device_valid`, `unmet_requirements`. Those tests would need adjusting in Stage C, and any change would be disclosed.

## 6. Appendix: all 263 functions

Guard: **System-only** refuses signed-in callers. **Refuses without permission** raises an error. **Permission logic** uses permission checks in its query. **Scoped to caller** uses the signed-in user. **Secret token required** needs a valid token hash. **None** has no caller check. "Used by" lists what needs direct access.

| Function | Can execute | Guard | Used by | Writes | `auth_private` | Proposed |
|---|---|---|---|---|---|---|
| `academic_eligibility` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `acknowledge_advisory` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `acknowledge_security_alert` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `active_sessions` | PUBLIC, erp_app | Refuses without permission | code | No | Yes | Revoke PUBLIC |
| `add_event` | erp_app | Permission logic | code | No | No | None |
| `add_event_internal` | owner only | Scoped to caller | internal | Yes | No | None |
| `advisory_snapshot` | PUBLIC, erp_app | None | internal | No | No | Revoke PUBLIC, Revoke erp_app |
| `applicable_rules` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `approve_attestation_route` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `approve_one_and_same_template` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `approve_verification_rule` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `attestation_file_target` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `attestation_on_document_change` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `attestation_state` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `attestation_step_action` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `audit` | erp_app | Scoped to caller | code | Yes | No | None |
| `audit_role_permissions` | owner only | Trigger | trigger | No | No | None |
| `audit_row` | owner only | Trigger | trigger | Yes | No | None |
| `audit_security_alerts` | PUBLIC | Trigger | trigger | No | Yes | Revoke PUBLIC |
| `auth_accept_invitation` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `auth_admin_issue_reset` | erp_app | Refuses without permission | code | Yes | Yes | None |
| `auth_admin_set_initial_password` | erp_app | Refuses without permission | internal | Yes | Yes | Revoke erp_app |
| `auth_begin_attempt` | erp_app | None | code | Yes | Yes | None |
| `auth_challenge_revoke_message` | owner only | Trigger | trigger | Yes | Yes | None |
| `auth_change_own_password` | erp_app | Refuses without permission | code | Yes | Yes | None |
| `auth_complete_reset` | erp_app | Secret token required | internal | Yes | Yes | Revoke erp_app |
| `auth_complete_reset_trusted` | erp_app | Secret token required | code | Yes | Yes | None |
| `auth_contact_revoke_message` | owner only | Trigger | trigger | No | Yes | None |
| `auth_create_session` | PUBLIC, erp_app | None | internal | Yes | Yes | Revoke PUBLIC, Revoke erp_app |
| `auth_finish_attempt` | erp_app | None | code | Yes | Yes | None |
| `auth_housekeeping` | erp_app | System-only | code | Yes | Yes | None |
| `auth_invitation_info` | PUBLIC, erp_app | Secret token required | code | No | Yes | Revoke PUBLIC |
| `auth_login_lookup` | erp_app | None | internal | No | Yes | Revoke erp_app |
| `auth_mask_error` | owner only | None | internal | No | No | None |
| `auth_message_claim` | erp_app | System-only | code | No | Yes | None |
| `auth_message_finish` | erp_app | System-only | code | Yes | Yes | None |
| `auth_message_housekeeping` | erp_app | System-only | code | Yes | Yes | None |
| `auth_message_log` | erp_app | Permission logic | code | No | Yes | None |
| `auth_mfa_challenge` | PUBLIC, erp_app | Secret token required | code | No | Yes | Revoke PUBLIC |
| `auth_mfa_complete` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `auth_mfa_enabled` | PUBLIC, erp_app | None | internal | No | Yes | Revoke PUBLIC, Revoke erp_app |
| `auth_mfa_failed` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `auth_mfa_use_recovery` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `auth_own_password_hash` | erp_app | Scoped to caller | code | No | Yes | None |
| `auth_pending_reset_requests` | erp_app | Permission logic | code | No | Yes | None |
| `auth_recent_failures` | erp_app | None | internal | No | Yes | Revoke erp_app |
| `auth_record_attempt` | erp_app | None | internal | Yes | Yes | Revoke erp_app |
| `auth_request_reset` | erp_app | None | internal | Yes | Yes | Revoke erp_app |
| `auth_request_reset_limited` | erp_app | None | code | Yes | Yes | None |
| `auth_reset_is_valid` | erp_app | Secret token required | code | No | Yes | None |
| `auth_resolve_session` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `auth_revoke_session` | erp_app | Secret token required | code | Yes | Yes | None |
| `auth_secret_cipher_ok` | owner only | None | internal | No | No | None |
| `auth_trust_device_after_mfa` | erp_app | None | code | Yes | Yes | None |
| `auth_verification_revoke_message` | owner only | Trigger | trigger | Yes | Yes | None |
| `authorize_attestation_file` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `authorize_file_access` | erp_app | Permission logic | code | No | No | None |
| `authorize_file_download` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `can_administer_user` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `can_assign_role` | PUBLIC, erp_app | Permission logic | code, policy | No | No | Revoke PUBLIC |
| `can_change_staff_photo` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `can_manage_user` | erp_app | Permission logic | policy | No | No | None |
| `can_on_student` | erp_app | Permission logic | code, policy, view | No | No | None |
| `can_read_audit_row` | erp_app | Permission logic | policy | No | No | None |
| `can_read_student` | erp_app | Permission logic | code, policy, view | No | No | None |
| `can_see_login_history` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `can_view_file` | PUBLIC, erp_app | Permission logic | policy | No | No | Revoke PUBLIC |
| `cancel_attestation` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `cancel_one_and_same` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `cancel_staff_invitation` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `change_student_stage` | erp_app | Refuses without permission | code | Yes | No | None |
| `claim_notifications` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `clear_file_manually` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `conditions_match` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `confirm_email_verification` | PUBLIC, erp_app | None | code | Yes | Yes | Revoke PUBLIC |
| `correct_exchange_rate` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `courier_scan_gate` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `create_referral` | owner only | None | internal | Yes | No | None |
| `decide_master_data_request` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `document_action` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `document_scan_gate` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `enqueue_notification` | PUBLIC | None | internal | Yes | No | Revoke PUBLIC |
| `ensure_document_checklist` | erp_app | Permission logic | code | No | No | None |
| `ensure_document_checklist_internal` | PUBLIC | Scoped to caller | internal | Yes | No | Revoke PUBLIC |
| `expire_email_verifications` | PUBLIC, erp_app | None | code | No | Yes | Revoke PUBLIC |
| `files_to_rescan` | PUBLIC, erp_app | System-only | code | No | No | Revoke PUBLIC |
| `find_duplicate_candidates` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `find_user_by_email` | PUBLIC, erp_app | Refuses without permission | code | No | No | Revoke PUBLIC |
| `finish_notification` | PUBLIC, erp_app | None | code | Yes | No | Revoke PUBLIC |
| `grant_new_permission_to_protected` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `guard_inactive_role` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `guard_protected_role` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `has_consent` | PUBLIC, erp_app | None | internal | No | No | Revoke PUBLIC, Revoke erp_app |
| `has_perm` | erp_app | Scoped to caller | policy | No | No | None |
| `holds_all_perms_of_role` | PUBLIC, erp_app | Permission logic | internal | No | No | Revoke PUBLIC, Revoke erp_app |
| `holds_role` | erp_app | Scoped to caller | code, policy | No | No | None |
| `is_assigned` | erp_app | Scoped to caller | internal | No | No | Revoke erp_app |
| `is_member` | erp_app | Scoped to caller | code, policy | No | No | None |
| `issue_courier_instructions` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `issue_payment_receipt` | owner only | Scoped to caller | internal | Yes | No | None |
| `issue_portal_account_link` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `issue_staff_invitation` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `last_logins` | PUBLIC, erp_app | Permission logic | code | No | Yes | Revoke PUBLIC |
| `lead_flag_duplicates` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `lead_log_changes` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `lead_on_admission` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `lead_route` | PUBLIC, erp_app | None | internal | No | No | Revoke PUBLIC, Revoke erp_app |
| `link_lead_student` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `login_history` | PUBLIC, erp_app | Refuses without permission | code | No | No | Revoke PUBLIC |
| `mark_alerts_emailed` | PUBLIC, erp_app | System-only | code | Yes | No | Revoke PUBLIC |
| `master_data_history` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `matching_attestation_routes` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `merge_students` | erp_app | Refuses without permission | code | Yes | No | None |
| `mfa_admin_reset` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `mfa_finish_enrolment` | PUBLIC, erp_app | Scoped to caller | code | Yes | Yes | Revoke PUBLIC |
| `mfa_my_status` | PUBLIC, erp_app | Scoped to caller | code | No | Yes | Revoke PUBLIC |
| `mfa_pending_secret` | PUBLIC, erp_app | Scoped to caller | code | No | Yes | Revoke PUBLIC |
| `mfa_start_enrolment` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `mfa_status_of_staff` | PUBLIC, erp_app | None | code | No | Yes | Revoke PUBLIC |
| `name_checks_on_record` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `new_attestation_route_version` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `new_rule_version` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `notification_context` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `notification_messages_no_auth_secrets` | owner only | Trigger | trigger | No | No | None |
| `notification_messages_no_portal_links` | owner only | Trigger | trigger | No | No | None |
| `notify_on_document_review` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `notify_on_stage_history` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `notify_on_student_change` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `one_and_same_requirement` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `one_and_same_status` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `open_one_and_same_case` | PUBLIC | Scoped to caller | internal | Yes | No | Revoke PUBLIC |
| `orgs_with_perm` | erp_app | Scoped to caller | policy, invoker-fn | No | No | None |
| `passport_close_tasks` | PUBLIC | None | internal | Yes | No | Revoke PUBLIC |
| `passport_monitor` | PUBLIC, erp_app | None | code | Yes | No | Revoke PUBLIC |
| `passport_verifier` | PUBLIC | None | internal | No | No | Revoke PUBLIC |
| `password_reset_supersede` | owner only | Trigger | trigger | Yes | Yes | None |
| `payment_status_counts` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `payments_after_insert` | owner only | Trigger | trigger | No | No | None |
| `payments_before_insert` | owner only | Trigger | trigger | No | No | None |
| `portal_account_info` | PUBLIC, erp_app | Permission logic | code | No | Yes | Revoke PUBLIC |
| `portal_choices` | PUBLIC, erp_app | Secret token required | code | No | Yes | Revoke PUBLIC |
| `portal_choose` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `portal_device_valid` | owner only | None | internal | No | Yes | None |
| `portal_download` | PUBLIC, erp_app | Permission logic | code | Yes | No | Revoke PUBLIC |
| `portal_email_claim` | erp_app | System-only | code | No | Yes | None |
| `portal_email_finish` | erp_app | System-only | code | Yes | Yes | None |
| `portal_email_housekeeping` | erp_app | System-only | code | Yes | Yes | None |
| `portal_email_status` | erp_app | Permission logic | code | No | Yes | None |
| `portal_link_check` | PUBLIC, erp_app | Secret token required | code | No | Yes | Revoke PUBLIC |
| `portal_link_cipher_ok` | owner only | None | internal | No | No | None |
| `portal_logout` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `portal_mark_notices_read` | PUBLIC, erp_app | Secret token required | code | Yes | No | Revoke PUBLIC |
| `portal_notice_on_document` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `portal_notice_on_shipment` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `portal_notice_on_stage` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `portal_notices` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_notify` | owner only | None | internal | Yes | No | None |
| `portal_overview` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `portal_password_begin` | erp_app | None | code | Yes | Yes | None |
| `portal_password_candidates` | PUBLIC, erp_app | None | internal | No | Yes | Revoke PUBLIC, Revoke erp_app |
| `portal_password_finish` | erp_app | None | code | Yes | Yes | None |
| `portal_password_result` | PUBLIC, erp_app | None | internal | Yes | Yes | Revoke PUBLIC, Revoke erp_app |
| `portal_payments` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_publications` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_referral_code` | PUBLIC, erp_app | Secret token required | code | Yes | No | Revoke PUBLIC |
| `portal_referrals` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_register_document_file` | PUBLIC, erp_app | Secret token required | code | Yes | No | Revoke PUBLIC |
| `portal_request_code` | PUBLIC, erp_app | None | code | Yes | Yes | Revoke PUBLIC |
| `portal_request_reset` | PUBLIC, erp_app | None | code | Yes | Yes | Revoke PUBLIC |
| `portal_session` | PUBLIC, erp_app | Secret token required | code | Yes | Yes | Revoke PUBLIC |
| `portal_set_password` | PUBLIC, erp_app | Secret token required | internal | Yes | Yes | Revoke PUBLIC, Revoke erp_app |
| `portal_set_password_trusted` | erp_app | Secret token required | code | No | Yes | None |
| `portal_shipments` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_student` | PUBLIC, erp_app | Secret token required | internal | No | Yes | Revoke PUBLIC, Revoke erp_app |
| `portal_submit_courier` | PUBLIC, erp_app | Secret token required | code | Yes | No | Revoke PUBLIC |
| `portal_submit_referral` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_token_revoke_email` | owner only | Trigger | trigger | Yes | Yes | None |
| `portal_upload_target` | PUBLIC, erp_app | Secret token required | code | No | No | Revoke PUBLIC |
| `portal_verify_code` | PUBLIC, erp_app | None | code | Yes | Yes | Revoke PUBLIC |
| `prepare_one_and_same` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `protected_role_all_permissions` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `public_countries` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `public_referral_info` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `public_submit_referral` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `publish_document` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `raise_security_alert` | PUBLIC | None | internal | Yes | No | Revoke PUBLIC |
| `reconcile_shipment` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `record_consent` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `record_courier_dispatch` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `record_document_custody` | erp_app | Refuses without permission | code | Yes | No | None |
| `record_document_merge` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `record_file_scan` | PUBLIC, erp_app | Permission logic | code | Yes | No | Revoke PUBLIC |
| `record_passport` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `record_verification` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `refresh_name_checks` | PUBLIC, erp_app | None | internal | Yes | No | Revoke PUBLIC, Revoke erp_app |
| `register_attestation_file` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `register_document_file` | erp_app | Refuses without permission | code | Yes | No | None |
| `remove_staff_photo` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `remove_student_photo` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `request_email_verification` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `request_master_data` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `request_one_and_same` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `retire_one_and_same_template` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `retry_notification` | PUBLIC, erp_app | Permission logic | code | Yes | No | Revoke PUBLIC |
| `review_name_check` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `revoke_sessions_on_deactivate` | owner only | Trigger | trigger | Yes | Yes | None |
| `revoke_trusted_on_credentials` | owner only | Trigger | trigger | Yes | Yes | None |
| `revoke_trusted_on_mfa` | owner only | Trigger | trigger | Yes | Yes | None |
| `revoke_trusted_on_portal_account` | owner only | Trigger | trigger | Yes | Yes | None |
| `revoke_trusted_on_status` | owner only | Trigger | trigger | Yes | Yes | None |
| `revoke_user_sessions` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `role_has_perm` | PUBLIC | None | internal | No | No | Revoke PUBLIC |
| `rule_facts` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `save_advisory_notice` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `save_courier_address` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `security_alerts_to_email` | PUBLIC, erp_app | System-only | code | No | No | Revoke PUBLIC |
| `set_academic_check` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_advisory_status` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_contact_required_stage` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_document_status` | owner only | Refuses without permission | internal | Yes | No | None |
| `set_portal_account_status` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `set_reporting_manager` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_role_structure` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_staff_photo` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `set_staff_status` | PUBLIC, erp_app | Refuses without permission | code | Yes | Yes | Revoke PUBLIC |
| `set_student_archived` | erp_app | Refuses without permission | code | Yes | No | None |
| `set_student_photo` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `shares_org_with` | erp_app | Scoped to caller | policy | No | No | None |
| `shipment_event` | PUBLIC | Scoped to caller | internal | Yes | No | Revoke PUBLIC |
| `staff_device_valid` | owner only | None | internal | No | Yes | None |
| `staff_email_claim` | erp_app | System-only | code | No | Yes | None |
| `staff_email_finish` | erp_app | System-only | code | Yes | Yes | None |
| `staff_invitations_overview` | PUBLIC, erp_app | Permission logic | code | No | Yes | Revoke PUBLIC |
| `staff_photo_file` | PUBLIC, erp_app | Scoped to caller | code | No | No | Revoke PUBLIC |
| `stage_requirement_issues` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `start_attestation` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `student_advisories` | PUBLIC, erp_app | None | code | No | No | Revoke PUBLIC |
| `student_has_org` | erp_app | None | code, policy | No | No | None |
| `student_has_outstanding_service_balance` | erp_app | Permission logic | code | No | No | None |
| `student_photo_file` | PUBLIC, erp_app | Permission logic | code | No | No | Revoke PUBLIC |
| `students_after_insert_checklist` | owner only | Trigger | trigger | No | No | None |
| `students_after_update_checklist` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `students_before_insert` | owner only | Trigger | trigger | No | No | None |
| `students_contact_history` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `students_master_data` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `students_passport_version` | PUBLIC | Trigger | trigger | Yes | No | Revoke PUBLIC |
| `students_stage_requirements` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `sync_student_org_access` | owner only | Trigger | trigger | Yes | No | None |
| `task_comments_after_insert` | owner only | Trigger | trigger | Yes | No | None |
| `tasks_after_write` | owner only | Trigger | trigger | Yes | No | None |
| `tasks_before_write` | owner only | Trigger | trigger | No | No | None |
| `trusted_device_add` | owner only | None | internal | Yes | Yes | None |
| `university_requirement_propagate` | PUBLIC | Trigger | trigger | No | No | Revoke PUBLIC |
| `unmet_requirements` | PUBLIC, erp_app | None | internal | No | No | Revoke PUBLIC, Revoke erp_app |
| `unpublish_document` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `update_admission_details` | erp_app | Refuses without permission | code | Yes | No | None |
| `update_shipment_status` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `update_visa_details` | erp_app | Refuses without permission | code | Yes | No | None |
| `user_is_active_member` | erp_app | None | code | No | No | None |
| `user_status_sync` | PUBLIC | Trigger | trigger | No | Yes | Revoke PUBLIC |
| `validate_assignment` | owner only | Trigger | trigger | No | No | None |
| `verify_passport` | PUBLIC, erp_app | Refuses without permission | code | Yes | No | Revoke PUBLIC |
| `verify_payment` | erp_app | Refuses without permission | code | Yes | No | None |
