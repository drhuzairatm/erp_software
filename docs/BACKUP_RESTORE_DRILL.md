# Backup → restore drill (Phase C) – 2026-11-01T08:35:54.660Z

**Result: PASSED** (31/31 checks)

- **Source:** local development database `erp_dev` with fictional demo/test data only (no real student data).
- **Method:** PostgreSQL online physical backup (low-level API `pg_backup_start`/`pg_backup_stop`, WAL 0/1E000028 → 0/1E000120), plus a copy of file storage.
- **Restore target:** a separate PostgreSQL 17 instance (own data folder `.data/restore-drill`, own port 54398). The source was never modified, apart from one audit marker written after the backup to prove the restore point.
- **Size:** database copy 108.7 MB, files 3.5 MB.
- **Timing:** backup 1.1 s; restore + start + full verification 0.7 s.
- **Cleanup:** the restored copy was deleted after verification.

## Checks
| Check | Result | Detail |
|---|---|---|
| restored server replayed the backup WAL and reached a consistent state | PASS | redo starts at 0/1E000028; redo done at 0/1E000120 system usage: CPU: user: 0.00 s, system: 0.00 s, elapsed: 0.00 s |
| restored database is open for normal use (not stuck in recovery) | PASS |  |
| all 102 tables restored with identical row counts and content hashes | PASS |  |
| students: 261 rows, content identical | PASS | hash dcf916f3f3ab… |
| student_documents: 2555 rows, content identical | PASS | hash a625fa45e4d6… |
| document_files: 338 rows, content identical | PASS | hash d9d2970e6782… |
| payment_entries: 183 rows, content identical | PASS | hash 16f0fa99821b… |
| student_assignments: 343 rows, content identical | PASS | hash bc44cfe45649… |
| organization_memberships: 38 rows, content identical | PASS | hash 79f550789d0c… |
| organizations: 2 rows, content identical | PASS | hash 0e61840d3f0c… |
| roles: 16 rows, content identical | PASS | hash da99dc21ea56… |
| role_permissions: 456 rows, content identical | PASS | hash 960fbb0553f2… |
| user_profiles: 35 rows, content identical | PASS | hash 645806c2f9d9… |
| tasks: 288 rows, content identical | PASS | hash a08386caabd7… |
| audit_logs: 10282 rows, content identical | PASS | hash c152e74ef38b… |
| security_alerts: 22 rows, content identical | PASS | hash b2d0aedf662a… |
| portal_publications: 0 rows, content identical | PASS | hash … |
| original_shipments: 14 rows, content identical | PASS | hash 8c7f54f6981a… |
| credentials and sessions (auth_private) restored | PASS |  |
| security objects restored (RLS, policies, triggers, app functions, application role) | PASS | {"rls_tables":89,"policies":149,"triggers":143,"app_functions":255,"app_role":1} |
| migration history restored (latest 0033) | PASS | 0031_master_data.sql,0032_staff_accounts.sql,0033_security_phase_b.sql |
| restore point is exact: a change made AFTER the backup is absent | PASS | restore-drill-1793522153961 |
| payment balances identical (5 company/ledger/currency groups: due, received, outstanding) | PASS |  |
| referential integrity: 293 foreign keys, no orphaned rows | PASS |  |
| company relationships consistent (each membership role belongs to its company) | PASS |  |
| staff assignments consistent (assignment company has access to the student) | PASS |  |
| application role can log in; without a user context RLS returns no student rows | PASS |  |
| storage keys remain unreadable to the application role | PASS | 42501 |
| audit log is still append-only after restore (owner cannot modify it) | PASS | audit_logs is append-only |
| stored files: 395 referenced, 395 present and verified (SHA-256 where recorded) | PASS | missing in backup copy: 0; checksum mismatches: 0; missing already at the source: 0; replaced photo versions whose files were deleted by design (not counted): 25 |
| no live file is missing at the source either (documents, attestation evidence, current photos) | PASS | 0 |

## Key tables (source at backup time vs restored)
| Table | Source rows | Restored rows | Content hash (identical in both) |
|---|---|---|---|
| students | 261 | 261 | `dcf916f3f3abab33` |
| student_documents | 2555 | 2555 | `a625fa45e4d64f4e` |
| document_files | 338 | 338 | `d9d2970e6782003b` |
| payment_entries | 183 | 183 | `16f0fa99821b4de0` |
| student_assignments | 343 | 343 | `bc44cfe456495b9e` |
| organization_memberships | 38 | 38 | `79f550789d0cee90` |
| organizations | 2 | 2 | `0e61840d3f0cf713` |
| roles | 16 | 16 | `da99dc21ea56d293` |
| role_permissions | 456 | 456 | `960fbb0553f21efb` |
| user_profiles | 35 | 35 | `645806c2f9d92e28` |
| tasks | 288 | 288 | `a08386caabd7330a` |
| audit_logs | 10282 | 10282 | `c152e74ef38be417` |
| security_alerts | 22 | 22 | `b2d0aedf662ae6e3` |
| portal_publications | 0 | 0 | `` |
| original_shipments | 14 | 14 | `8c7f54f6981a8b40` |

## What this does and does not prove
- **Proves:** a consistent online backup of the running database, together with its files, restores into an isolated server. That includes every row, security rules, the application role, the audit log and files, with nothing missing or corrupted.
- **Production backups differ:** they use the hosting provider's backups (e.g. Supabase daily / PITR), and `pg_dump` copies are kept off-site, as described in BACKUP_RECOVERY.md. Those must be restore-tested the same way on **staging** once hosting exists.
- **`pg_dump`/`pg_restore` not tested:** these command-line tools are not installed on this computer. Downloading them was not permitted in this session.
