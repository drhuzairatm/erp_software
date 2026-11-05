# Stages A and B: proposed permission change

**Status:** proposal only, **not approved and not applied**. By MD decision of 4 Nov 2026 it waits for the Security Hardening phase after Phase 11, where it must be reviewed again against functions added by then. The SQL is in `docs/audit/proposed/`, deliberately outside `backend/db/migrations`, so no migration run picks it up.
**Tested on:** a throwaway copy of the project with a fictional database.

## What it does

- **Stage A:** `alter default privileges revoke execute on functions from public;`
- **Stage B:** 173 explicit `revoke execute on function ... from public;` statements, then a check that stops the migration if any SECURITY DEFINER function in `app` is still PUBLIC.

## What it does not do

**It does not fix the `erp_app` risk.** All 43 attempts gave the same results before and after, as did 4 later checks on audit forgery, MFA and hash reading: see `ERP_APP_TRUST_BOUNDARY_REVIEW.md`. Its value is closing the route for any other role, now and in future.

## Will anything break?

| Evidence | Result |
|---|---|
| Runtime roles on the local databases | `erp_app` and `postgres` only. Production may differ |
| Functions whose PUBLIC flag changes | 173, and no others |
| Function bodies | Identical before and after |
| Functions where `erp_app` keeps access | 140, through its existing explicit grant, so nothing can change for them |
| Functions where `erp_app` loses its only route | **33:** 25 trigger functions and 8 internal functions |
| References to those 33 from application code, 149 policies, 3 views, 310 checks, 372 defaults, 28 invoker functions, 270 indexes, 154 triggers' conditions or 2 rules | **None** (name search of definitions) |
| Those 33 called during the test run | **33 of 33**, with no permission error |
| 173 called during tests | 173, after happy-path tests were added for the last ones |
| `permission denied for function` in database logs | 3, none among the 173: `auth_mask_error`, `portal_link_cipher_ok`, `staff_device_valid`. Those are already restricted, and tests attempt them on purpose |

| Regression with A and B | Result |
|---|---|
| Typecheck, lint | Pass |
| Backend tests | 499 of 499 |
| Migration tests | 3 of 3 |
| Frontend integration tests | 131 of 131 |
| Browser tests | 130 of 130 |

Typecheck, lint, frontend and browser runs came before the final two backend tests were added. Application code did not change after them.

**By feature area (173):** sign-in and sessions 21, student portal 34, notifications 19, documents and files 46, students 27, staff and roles 13, courier 6, leads 5, finance 2. The area labels come from function names, for orientation only.

**So I can confirm this for the local system, on this evidence.** It isn't proven for production, whose roles and owners were not inspected. A role there using `app` functions would lose them.

**Required test changes if approved.** On the first run 14 tests failed, because three files pin exact access-list text and left the database rolled back for later tests: `auth-db-security`, `auth-message-db-security` and `portal-link-db-security`. With their expectations updated in the throwaway copy only, everything passed. These edits are not in the project.

## Future functions

| Case | With A | Tested |
|---|---|---|
| New function created by the migration role | **No PUBLIC, no `erp_app`.** The migration must grant `erp_app` explicitly | Yes |
| `create or replace` on an existing function | Keeps its grants | Yes |
| New function created by a **different** role | **Still PUBLIC.** Default privileges apply only to the role that ran the statement | Yes |
| New database | Applies once 0039 runs. Existing functions are covered by its explicit list | Yes |

**Implications:**
- Migrations must always run as the same role. That can't be confirmed for production.
- Later rollback files that recreate a function must also grant it.
- I recommend adding a test that fails if any privileged function is PUBLIC.
- The 20 non-privileged `app` functions stay PUBLIC. They run with the caller's own rights, so they aren't part of this finding.

## Rollback

```
npm run db:migrate -- --rollback 0039
```

| Check | Result |
|---|---|
| PUBLIC and `erp_app` access for all 291 functions compared with the original | **0 differences** |
| Default privileges | Removed, then present again on re-apply |
| Re-apply after rollback | 0 differences |
| Table data | Only `schema_migrations` changes |
| Access-list text | Same permissions, different order; functions that had none stored now have explicit text |

## Function by function (173)

"Needs `erp_app`" means it is called directly by code, a policy, a view, a check, a default or an invoker function. Trigger and internal functions don't need it. The last column shows whether it ran during backend and frontend tests.

| Function | Area | How it is reached | Needs `erp_app` | `erp_app` after B | Called in tests |
|---|---|---|---|---|---|
| `academic_eligibility(p_student uuid)` | Students | Direct: code | Yes | Keeps | Yes |
| `acknowledge_advisory(p_student uuid, p_notice uuid)` | Students | Direct: code | Yes | Keeps | Yes |
| `acknowledge_security_alert(p_alert uuid, p_note text)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `active_sessions(p_user uuid)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `advisory_snapshot(p_notice uuid)` | Students | Internal (called by privileged functions) | No | Keeps | Yes |
| `applicable_rules(p_document uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `approve_attestation_route(p_route uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `approve_one_and_same_template(p_template uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `approve_verification_rule(p_rule uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `attestation_file_target(p_step uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `attestation_on_document_change()` | Documents and files | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `attestation_state(p_document uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `attestation_step_action(p_step uuid, p_action text, p_reference text, p_date date, p_comment text, p_assignee uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `audit_security_alerts()` | Notifications | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `auth_accept_invitation(p_token_hash text, p_password_hash text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_create_session(p_user uuid, p_token_hash text, p_ttl_hours integer, p_ip text, p_user_agent text, p_mfa_pending boolean)` | Sign-in and sessions | Internal (called by privileged functions) | No | Keeps | Yes |
| `auth_invitation_info(p_token_hash text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_mfa_challenge(p_token_hash text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_mfa_complete(p_token_hash text, p_step bigint, p_ttl_hours integer)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_mfa_enabled(p_user uuid)` | Sign-in and sessions | Internal (called by privileged functions) | No | Keeps | Yes |
| `auth_mfa_failed(p_token_hash text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_mfa_use_recovery(p_token_hash text, p_code_hash text, p_ttl_hours integer)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `auth_resolve_session(p_token_hash text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `authorize_attestation_file(p_file uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `authorize_file_download(p_file uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `can_administer_user(p_user uuid)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `can_assign_role(p_role uuid)` | Staff and roles | Direct: code, policy | Yes | Keeps | Yes |
| `can_change_staff_photo(p_user uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `can_see_login_history(p_user uuid)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `can_view_file(p_file uuid)` | Documents and files | Direct: policy | Yes | Keeps | Yes |
| `cancel_attestation(p_attestation uuid, p_reason text)` | Documents and files | Direct: code | Yes | Keeps | No |
| `cancel_one_and_same(p_case uuid, p_reason text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `cancel_staff_invitation(p_user uuid)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `claim_notifications(p_limit integer)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `clear_file_manually(p_file uuid, p_reason text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `conditions_match(p_cond jsonb, p_student uuid, p_document uuid)` | Students | Direct: code | Yes | Keeps | Yes |
| `confirm_email_verification(p_token_hash text)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `correct_exchange_rate(p_entry uuid, p_rate numeric, p_reason text)` | Finance | Direct: code | Yes | Keeps | Yes |
| `courier_scan_gate()` | Documents and files | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `decide_master_data_request(p_request uuid, p_approve boolean, p_note text, p_code text)` | Students | Direct: code | Yes | Keeps | Yes |
| `document_action(p_document uuid, p_action text, p_reason text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `document_scan_gate()` | Documents and files | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `enqueue_notification(p_student uuid, p_event text, p_params jsonb)` | Notifications | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `ensure_document_checklist_internal(p_student uuid)` | Documents and files | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `expire_email_verifications()` | Notifications | Direct: code | Yes | Keeps | Yes |
| `files_to_rescan(p_limit integer)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `find_duplicate_candidates(p_phone text, p_email text, p_exclude uuid, p_passport text)` | Students | Direct: code | Yes | Keeps | Yes |
| `find_user_by_email(p_email text)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text, p_subject text, p_body text, p_retry_in_seconds integer)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `grant_new_permission_to_protected()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `guard_inactive_role()` | Staff and roles | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `guard_protected_role()` | Staff and roles | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `has_consent(p_student uuid, p_channel text, p_recipient text)` | Notifications | Internal (called by privileged functions) | No | Keeps | Yes |
| `holds_all_perms_of_role(p_role uuid)` | Staff and roles | Internal (called by privileged functions) | No | Keeps | Yes |
| `issue_courier_instructions(p_student uuid, p_address uuid, p_documents uuid[], p_exception text)` | Courier | Direct: code | Yes | Keeps | Yes |
| `issue_portal_account_link(p_student uuid, p_token_hash text, p_link text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `issue_staff_invitation(p_user uuid, p_token_hash text, p_days integer)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `last_logins()` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `lead_flag_duplicates()` | Leads | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `lead_log_changes()` | Leads | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `lead_on_admission()` | Leads | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `lead_route(p_programme text)` | Leads | Internal (called by privileged functions) | No | Keeps | Yes |
| `link_lead_student(p_lead uuid, p_student uuid)` | Leads | Direct: code | Yes | Keeps | Yes |
| `login_history(p_user uuid, p_limit integer)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `mark_alerts_emailed(p_ids uuid[])` | Notifications | Direct: code | Yes | Keeps | Yes |
| `master_data_history(p_perms text[])` | Students | Direct: code | Yes | Keeps | Yes |
| `matching_attestation_routes(p_document uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `mfa_admin_reset(p_user uuid, p_reason text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `mfa_finish_enrolment(p_step bigint, p_recovery_hashes text[])` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `mfa_my_status()` | Sign-in and sessions | Direct: code | Yes | Keeps | No |
| `mfa_pending_secret()` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `mfa_start_enrolment(p_secret_encrypted text)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `mfa_status_of_staff()` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `name_checks_on_record()` | Documents and files | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `new_attestation_route_version(p_route uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `new_rule_version(p_rule uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `notification_context(p_id uuid)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `notify_on_document_review()` | Notifications | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `notify_on_stage_history()` | Notifications | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `notify_on_student_change()` | Notifications | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `one_and_same_requirement(p_check uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `one_and_same_status(p_case uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `open_one_and_same_case(p_check uuid, p_requirement text, p_rule uuid)` | Documents and files | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `passport_close_tasks(p_passport uuid, p_status text)` | Students | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `passport_monitor(p_student uuid)` | Students | Direct: code | Yes | Keeps | Yes |
| `passport_verifier(p_student uuid, p_org uuid)` | Students | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `payment_status_counts(p_orgs uuid[])` | Finance | Direct: code | Yes | Keeps | Yes |
| `portal_account_info(p_student uuid)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_choices(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | No |
| `portal_choose(p_token_hash text, p_student uuid)` | Student portal | Direct: code | Yes | Keeps | No |
| `portal_download(p_token_hash text, p_publication uuid, p_ip text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_link_check(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_logout(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | No |
| `portal_mark_notices_read(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_notice_on_document()` | Student portal | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `portal_notice_on_shipment()` | Student portal | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `portal_notice_on_stage()` | Student portal | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `portal_notices(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_overview(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_password_candidates(p_identifier text)` | Student portal | Internal (called by privileged functions) | No | Keeps | Yes |
| `portal_password_result(p_identifier text, p_ok uuid[], p_failed uuid[], p_token_hash text, p_ip text, p_user_agent text)` | Student portal | Internal (called by privileged functions) | No | Keeps | Yes |
| `portal_payments(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_publications(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_referral_code(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_referrals(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_register_document_file(p_token_hash text, p_document uuid, p_storage_key text, p_filename text, p_mime text, p_size integer, p_sha256 text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_request_code(p_identifier text, p_code text, p_code_hash text, p_ip text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_request_reset(p_identifier text, p_token_hash text, p_link text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_session(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | No |
| `portal_set_password(p_token_hash text, p_password_hash text)` | Student portal | Internal (called by privileged functions) | No | Keeps | Yes |
| `portal_shipments(p_token_hash text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_student(p_token_hash text)` | Student portal | Internal (called by privileged functions) | No | Keeps | Yes |
| `portal_submit_courier(p_token_hash text, p_shipment uuid, p_company text, p_tracking text, p_date date)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_submit_referral(p_token_hash text, p jsonb, p_ip text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_upload_target(p_token_hash text, p_document uuid)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `portal_verify_code(p_challenge uuid, p_code_hash text, p_token_hash text, p_ip text, p_user_agent text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `prepare_one_and_same(p_case uuid, p_template uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `protected_role_all_permissions()` | Staff and roles | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `public_countries()` | Student portal | Direct: code | Yes | Keeps | No |
| `public_referral_info(p_code text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `public_submit_referral(p_code text, p jsonb, p_ip text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `publish_document(p_document uuid, p_title text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `raise_security_alert(p_kind text, p_severity text, p_title text, p_subject text, p_details jsonb, p_actor uuid, p_org uuid)` | Notifications | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `reconcile_shipment(p_shipment uuid, p_items jsonb)` | Courier | Direct: code | Yes | Keeps | Yes |
| `record_consent(p_student uuid, p_channel text, p_recipient text, p_granted boolean, p_source text)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `record_courier_dispatch(p_shipment uuid, p_company text, p_tracking text, p_date date, p_expected date)` | Courier | Direct: code | Yes | Keeps | No |
| `record_document_merge(p_student uuid, p_filename text, p_files uuid[], p_university uuid, p_purpose text, p_pages integer, p_unapproved boolean, p_outcome text, p_failure text, p_mode text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `record_file_scan(p_storage_key text, p_status text, p_engine text, p_detail text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `record_passport(p_student uuid, p_kind text, p_number text, p_holder text, p_dob date, p_gender text, p_nationality uuid, p_citizenship uuid, p_issuing uuid, p_issue date, p_expiry date, p_place text, p_notes text)` | Students | Direct: code | Yes | Keeps | Yes |
| `record_verification(p_document uuid, p_requirement uuid, p_result text, p_comment text, p_detected boolean)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `refresh_name_checks(p_student uuid)` | Documents and files | Internal (called by privileged functions) | No | Keeps | Yes |
| `register_attestation_file(p_step uuid, p_key text, p_filename text, p_mime text, p_size integer, p_sha256 text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `remove_staff_photo(p_user uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `remove_student_photo(p_student uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `request_email_verification(p_student uuid, p_token_hash text, p_link text)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `request_master_data(p_kind text, p_name text, p_country uuid, p_details text)` | Students | Direct: code | Yes | Keeps | Yes |
| `request_one_and_same(p_case uuid, p_channel text, p_note text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `retire_one_and_same_template(p_template uuid)` | Documents and files | Direct: code | Yes | Keeps | No |
| `retry_notification(p_id uuid)` | Notifications | Direct: code | Yes | Keeps | Yes |
| `review_name_check(p_check uuid, p_decision text, p_note text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `revoke_user_sessions(p_user uuid)` | Sign-in and sessions | Direct: code | Yes | Keeps | Yes |
| `role_has_perm(p_role uuid, p_perm text)` | Staff and roles | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `rule_facts(p_student uuid, p_document uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `save_advisory_notice(p_group uuid, p jsonb, p_items jsonb, p_reason text)` | Students | Direct: code | Yes | Keeps | Yes |
| `save_courier_address(p_id uuid, p_org uuid, p_label text, p_recipient text, p_address text, p_phone text, p_instructions text, p_active boolean)` | Courier | Direct: code | Yes | Keeps | Yes |
| `security_alerts_to_email()` | Notifications | Direct: code | Yes | Keeps | Yes |
| `set_academic_check(p_stage text, p_check text)` | Students | Direct: code | Yes | Keeps | No |
| `set_advisory_status(p_group uuid, p_active boolean, p_reason text)` | Students | Direct: code | Yes | Keeps | Yes |
| `set_contact_required_stage(p_stage text)` | Students | Direct: code | Yes | Keeps | No |
| `set_portal_account_status(p_student uuid, p_enabled boolean, p_reason text)` | Student portal | Direct: code | Yes | Keeps | Yes |
| `set_reporting_manager(p_user uuid, p_manager uuid)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `set_role_structure(p_role uuid, p_active boolean, p_parent uuid)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `set_staff_photo(p_user uuid, p_original text, p_mime text, p_display text, p_thumb text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `set_staff_status(p_user uuid, p_status text, p_reason text)` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `set_student_photo(p_student uuid, p_original text, p_mime text, p_portrait text, p_thumb text, p_width integer, p_height integer, p_bytes integer)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `shipment_event(p_shipment uuid, p_action text, p_detail text, p_actor_type text)` | Courier | Internal (called by privileged functions) | No | Has none today via grant: loses PUBLIC route | Yes |
| `staff_invitations_overview()` | Staff and roles | Direct: code | Yes | Keeps | Yes |
| `staff_photo_file(p_user uuid, p_variant text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `stage_requirement_issues(p_student uuid, p_to_stage text)` | Students | Direct: code | Yes | Keeps | Yes |
| `start_attestation(p_document uuid, p_route uuid)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `student_advisories(p_student uuid)` | Students | Direct: code | Yes | Keeps | Yes |
| `student_photo_file(p_student uuid, p_variant text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `students_after_update_checklist()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `students_contact_history()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `students_master_data()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `students_passport_version()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `students_stage_requirements()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `university_requirement_propagate()` | Students | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `unmet_requirements(p_document uuid)` | Students | Internal (called by privileged functions) | No | Keeps | Yes |
| `unpublish_document(p_publication uuid, p_reason text)` | Documents and files | Direct: code | Yes | Keeps | Yes |
| `update_shipment_status(p_shipment uuid, p_status text, p_note text)` | Courier | Direct: code | Yes | Keeps | Yes |
| `user_status_sync()` | Sign-in and sessions | Trigger | No | Has none today via grant: loses PUBLIC route | Yes |
| `verify_passport(p_passport uuid, p_decision text, p_note text)` | Students | Direct: code | Yes | Keeps | Yes |
