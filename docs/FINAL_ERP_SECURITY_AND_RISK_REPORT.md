# Final ERP Security and Risk Report

**Date:** 5 November 2026. **Handling: keep private, out of Git.** It records known weaknesses at summary level only and has no credentials, attack steps or server details.

**The ERP is not described as fully secure.** A known database-identity weakness is unresolved. Its fix was postponed until after Phase 11 by your instruction.

## G. Security

### Controls preserved

Argon2id, Node-verified MFA, sessions, secure cookies, RLS, company isolation, database permissions, audit triggers and logs, signed file links, content security policy. No login, ORM, framework or password change was made. The proposed `erp_system` login was not introduced and no trust boundary fix was started.

### New access controls in Phases 1 to 11

| Area | Control |
|---|---|
| New tables (50 across 0039 to 0050) | RLS in the same migration; application writes go through checked functions |
| New definer functions | Fixed `search_path` and PUBLIC execute removed |
| Secure files | Access follows the parent record, per context: task, employee, attendance, meeting, chat, DVR, ticket |
| Chat | Members only. There is no general administrator access to private conversations; investigation access is named, reasoned and audited |
| Portal tickets | A student reaches only their own tickets, through their portal session; other students and staff without access are refused |
| Finance | `payments.read` and `payments.record`; verifier must differ from recorder; reminders contain no amounts or names |
| Reports | Attendance and task reports need `attendance.view` and `staff.workload.view`; exports are checked and audited |

### Test evidence

| Check | Result |
|---|---|
| Permission and company isolation, database level | Passed in phase tests, in the 651 backend tests |
| Unauthorized browser attempts | Passed, workflow 23 |
| File access: other company, signed out, not a member | Passed |
| Audit entries for due dates, exports, governance | Passed |
| SQL guard | 364 files, 22 findings all in the approved baseline, 0 not approved |

### Interaction with the unresolved trust boundary

Every feature in Phases 1 to 11 uses the existing application database identity, so new tables and functions share the same limit. RLS and function checks protect normal use of the application. They do not fully protect against someone who obtains the application's database access directly. New financial, chat and student data therefore adds to what is at stake until the fix is done. Details are in the private `docs/audit/ERP_APP_TRUST_BOUNDARY_REVIEW.md`.

### Bugs found and fixed in this work

| Bug | How found | State |
|---|---|---|
| A counsellor could assign an unassigned ticket to someone else, and Documentation could hand over an unassigned DVR. A null comparison skipped the check | Phase 8 test | Fixed in 0046 and 0048 before they were applied. Applied migrations 0039 to 0045 were checked for the same pattern |
| The 0046 rollback failed when real rows existed | Security rollback tests | Fixed. Rollback tests now use real rows |
| Reminder links with a query string were silently dropped, because `staff_notify` swallows errors | Phase 10 test | Link corrected. The swallowing remains by design, and is a risk for future events |

### Risks

| Severity | Risk | Next step |
|---|---|---|
| Critical | Trust boundary unresolved | Security Hardening, with your approval |
| High | 173 older definer functions are executable by PUBLIC | Same stage |
| High | No virus scanner: uploads, including chat and portal files, are unscanned and labelled | Install and prove a scanner |
| High | Security-sensitive documents may enter Git. See the private list in the implementation report | Move or revise before any push |
| Medium | Sensitive documents already committed: `SECURITY_GAP_ANALYSIS.md`, `SECURITY_THREAT_ASSESSMENT.md`, `SECURITY_EVIDENCE_REGISTER.md`, `PHASE_B_SECURITY_REPORT.md`, `SECURITY_REPORT.md`; VPS details in `RESEND_TO_NODEMAILER_DEPLOYMENT_READINESS.md` and `EMAIL_DELIVERY_AUDIT.md` | Revise. Past commits keep the old text unless history is rewritten |
| Medium | Attendance photos and location, chat oversight: legal review and employee notice not confirmed | Your decision, with legal advice |
| Medium | Hard-coded `manager` role check in `frontend/src/app/(app)/students/[id]/page.tsx` | Replace with a permission check |
| Low | Audit logs and backups have no agreed retention period | Your decision |

No external penetration test was performed.
