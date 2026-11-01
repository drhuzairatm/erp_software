# User acceptance testing checklist (fictional data only)

Run on **staging** loaded with demo data (`db:seed`). Use only invented names and placeholder files.
Record Pass / Fail / Notes for each line. Real student data may be used only after every
**must-pass** item (★) passes and the go-live checklist in DEPLOYMENT.md is complete.

## A. Access and isolation ★
| # | Test | Account | Expected |
|---|---|---|---|
| A1 ★ | Sign in with wrong password 6 times | any | generic error, then temporary block |
| A2 ★ | Open Students | grd.counsellor | only GRD-… IDs |
| A3 ★ | Paste the URL of an EDX student (copy from an MD session) | grd.counsellor | "Not found" |
| A4 ★ | Paste a document file link copied from an Edulinks manager | grd.manager | "Not found" |
| A5 ★ | Wait 2 minutes after opening a file, reload the file tab | edx.manager | link expired |
| A6 ★ | Open /api/reports/student-list | grd.counsellor | not available |
| A7 ★ | Check Students list | admin@demo.test | no student access |
| A8 ★ | Look at Students | docs@demo.test | only assigned students (EDX and GRD) |
| A9 ★ | Phone/email on a profile | edx.finance | masked |
| A10 ★ | Deactivate a user while they are signed in elsewhere | admin | they are signed out at next click |

## A2. Hierarchy, permissions and two-factor login ★
| # | Test | Expected |
|---|---|---|
| P1 ★ | CEO opens Dashboard, Students, a student profile, Reports | counts for payments only; no ₹ amounts, no Payments tab, no ledger, no balance report |
| P2 ★ | MD opens Payment ledger and dashboard | amounts visible |
| P3 ★ | MD → Roles: try to change the MD role | locked |
| P4 ★ | Administrator tries to reset the MD's password or 2FA | not offered / refused |
| P5 ★ | MD grants CEO "Create staff accounts"; CEO adds a staff member | only roles within the CEO's own permissions are offered; privileged roles not offered |
| P6 ★ | Anyone tries to tick a permission they do not hold | checkbox disabled; server refuses |
| P7 ★ | Set up 2FA, sign out, sign in | code required; wrong code shows attempts left; recovery code works once |
| P8 | With `MFA_ENFORCE=roles`, sign in as finance without 2FA | must set up 2FA before any page works |
| P9 | Assign departments to staff | shown in the user menu and staff list |

## A3. Education background, passport, universities
| # | Test | Expected |
|---|---|---|
| U1 | Register a student educated in Qatar going to Russia | both shown separately on the profile; *Educated in* filter finds them |
| U2 ★ | Passport number entered by a manager; open the profile as finance and as CEO | masked (•••••123); never shown in full |
| U3 | Search by passport number as manager | found |
| U4 | Register another student with the same passport in the other brand | duplicate warning naming only the company |
| U5 | Add a required document to a university; open a student assigned to it | the document appears marked *University requirement* |
| U6 | Course-specific requirement (e.g. Nursing only) | appears only for students of that course |
| U7 | Counsellor opens a university | can read; no add/edit buttons |
| U8 | Set the certificate issuing country on a document | shown in the checklist |

## A4. Document verification and approval ★
| # | Test | Expected |
|---|---|---|
| V1 ★ | Documentation staff open a Bonafide PDF of a student educated in India | PDF shows in the portal; checklist shows the India wording; "Found on page" if the text is in the PDF |
| V2 ★ | Try *Mark verified* before ticking all mandatory checks | not allowed |
| V3 | Tick "Missing" without a comment | refused |
| V4 | Select text, add a comment | comment listed with page and highlighted |
| V5 ★ | Submit; the same person (if a manager) tries to approve | refused — a different person must approve |
| V6 ★ | Another manager approves | status Approved; history shows verifier and approver |
| V7 ★ | Upload a new version of an approved document | back to "Uploaded – pending review"; old checks remain in the record but do not count |
| V8 | MD edits a verification rule | approved rule locked; new version created, approved; old version retired |
| V9 ★ | CEO / counsellor try to view or download a file | not allowed |
| V10 | Scanned (image) PDF | no detection hint; checks done visually |

## A5. Notifications (test mode)
| # | Test | Expected |
|---|---|---|
| N1 ★ | Register a student WITHOUT ticking consent; change stage | message recorded as *Skipped – no consent* |
| N2 ★ | Register with WhatsApp consent; change stage | message *Test – not sent* with correct wording |
| N3 | Withdraw consent on the Messages tab; change stage again | skipped |
| N4 | Request changes on a document | message includes the document and reason |
| N5 | Notification settings: switch a rule off | no message for that event |
| N6 ★ | Put your own number in the test list (technical admin), trigger an event | WhatsApp arrives via Gallabox (confirms the integration) |
| N7 | Finance user opens a student's messages | not visible |

## A6. Student portal (fictional students only)
| # | Test | Expected |
|---|---|---|
| S1 ★ | Request a code with a demo student's email; enter it (staff read it from Messages while in test mode) | signed in to that student's page |
| S2 ★ | Wrong code 5 times | sign-in cancelled; must request a new code |
| S3 ★ | Request a code for an unknown email | same "If we found your details…" page, no code works |
| S4 ★ | Portal page shows no internal notes, payments, contact details of others | confirmed |
| S5 | Upload a requested document | "Received – being checked"; staff see it from *Student (portal)* and must verify/approve |
| S6 | Staff request changes with a reason | student sees the reason and can upload again |
| S7 | Leave the portal idle 30 minutes | must sign in again |
| S8 | Student registered with both brands | asked which application to view |
| S9 | Open the portal on a phone | readable and usable |

## B. Students
| # | Test | Expected |
|---|---|---|
| B1 | Register a student with phone only; with email only; with neither | first two succeed, third shows error |
| B2 | Student ID format and uniqueness | `EDX-YY-######` / `GRD-YY-######`, never repeats |
| B3 | Register using an existing phone of the other brand | warning names only the other company |
| B4 | Search by Student ID, name, phone | finds the student |
| B5 | Filters: country, course, university, stage, status, staff, next action overdue | correct results, pagination works |
| B6 | Edit details | timeline shows "Details updated: …" |
| B7 | Merge a duplicate (MD) | notes/tasks/documents/payments move; old record shows "Merged into …" |
| B9 | Import the template CSV (after editing the example rows) | preview shows statuses; import creates students with IDs |
| B10 | Import a file with an unknown country, a bad date, and a repeated phone | rows flagged as Error / Possible duplicate and skipped |
| B11 | Counsellor opens Students → Import CSV | not available |
| B8 | Archive and restore (manager) | hidden from default list; visible with *Archived* filter |

## C. Workflow
| # | Test | Expected |
|---|---|---|
| C1 | Counsellor tries visa stage | not offered |
| C2 | Move to University Application with missing documents | warning; requires acknowledgement |
| C3 | On Hold without reason | blocked |
| C4 | Stage history | shows from/to, user, time, reason, next action |
| C5 | Georgia MBBS student | Translation stage not offered |

## D. Documents
| # | Test | Expected |
|---|---|---|
| D1 | Upload a PDF / JPG | status *Uploaded* (not approved) |
| D2 | Upload a renamed .exe or a 12 MB file | rejected |
| D3 | Reject without reason | blocked; with reason → shown in red |
| D4 | Upload a new version | version 2, history kept |
| D5 | Record original location + tracking number | shown in history |
| D6 | Counsellor tries to open a file | no button / not found |

## E. Tasks
| # | Test | Expected |
|---|---|---|
| E1 | Assign task with past due date | appears under *Overdue* and in Alerts of assignee |
| E2 | Assignee sets *Waiting on external* without party | blocked |
| E3 | Assignee tries to reassign | not allowed |
| E4 | Manager reassigns | history shows reassignment |
| E5 | Dashboard separates internal vs external overdue | figures match task list |

## F. Payments
| # | Test | Expected |
|---|---|---|
| F1 | Record charge 25,000 and receipt 25,000 | outstanding stays 25,000 until verified |
| F2 | Same person tries to verify | not offered / refused |
| F3 | Second finance user verifies | outstanding becomes 0 |
| F4 | Reverse a verified entry | reversal pending, then corrects the balance after verification; original untouched |
| F5 | University fee receipt + disbursement | separate third-party section; service balance unaffected |
| F6 | Counsellor opens Payments | not available |

## G. Dashboards, reports, audit
| # | Test | Expected |
|---|---|---|
| G1 | MD consolidated vs single-company dashboard | numbers add up |
| G2 | Click each card | opens the matching filtered list |
| G3 | Export balances (finance) and student list (MD) | CSV opens correctly in Excel |
| G4 | Audit log shows the exports, file access, failed logins, permission changes | yes |

## G2. Attestation & apostille (Phase 1)

- [ ] As MD: Admin → Attestation routes shows the [TO CONFIRM] routes and their authorities.
- [ ] As System Administrator: create a draft route with two stages and reorder them; you cannot approve it.
- [ ] As MD: approve it. It can no longer be edited, and "Create new version" makes an editable copy.
- [ ] A document that is not approved shows "Attestation can start once … approved by a manager".
- [ ] An approved document with its issuing country set shows "Ready for attestation" with the matching route.
- [ ] Documentation staff start it; "Mark completed" without a reference shows an error; with a reference it completes.
- [ ] Stages cannot be completed out of order.
- [ ] Documentation staff cannot skip a mandatory stage; a Manager can, with a reason (the reason appears in the audit log).
- [ ] Uploading a new version cancels the attestation in progress (see "Earlier attestations").
- [ ] The student portal shows "Attestation / apostille in progress: step n of m".
- [ ] Reports → Attestation progress lists the current stage, authority and days in stage. A GRADUATER-only user sees no Edulinks rows.

## G3. Passport, phones and email verification (Phase 2)

- [ ] Register a student with an Indian primary number and a UAE secondary number (search "971" in the country picker). The profile shows both, each with its country, marked "not verified".
- [ ] Type a +91 number while the UAE is selected: a warning appears, and saving is refused with an explanation.
- [ ] A draft student without a secondary phone or email can move to Registration, but not to University Application or later.
- [ ] Send a verification email; the status becomes "Verification pending". Open the link from Messages (test mode), press Confirm: the status becomes "Verified". Change the email address: it goes back to "Not verified".
- [ ] Edit a phone number: Overview → Contact change history shows the old and new value, country and your name.
- [ ] Passport tab: record a renewal with a new number. The old passport stays in the history, the status becomes Valid, and the passport tasks are completed.
- [ ] A student whose passport expires within 3 months shows "Passport: Critical", and has a counsellor task plus a manager escalation task (only once, even after the daily job runs again).
- [ ] As System Administrator: add a minimum validity rule (e.g. 18 months from Visa Processing, Block). A student with less validity cannot be moved to Visa Processing.
- [ ] The CEO sees the passport status but not the passport number or dates.
- [ ] Dashboard "Passports needing renewal" and Reports → Passport expiry match each other.

## G4. Academic records, name checks, One and Same (Phase 3)

- [ ] Academic tab: add a Plus Two with marks per subject. The percentage is calculated, and a CGPA record shows no percentage.
- [ ] A Bulgaria student with Chemistry below 60% shows "Below threshold"; moving to University Application shows the warning to acknowledge.
- [ ] A Postgraduate Medical student is offered MBBS, internship and registration first.
- [ ] Passport tab: record the holder name. A certificate with the surname missing shows "Surname missing — needs human review".
- [ ] "Same person – no document needed" needs a note; "Require One and Same" adds a checklist item.
- [ ] As administrator: draft a One and Same template. As a manager: approve it. The approved template can no longer be edited.
- [ ] Choose the template, Generate preview (names filled in), record a manual request: the status is Pending. Upload, verify and approve the document: the status follows Received → Verified → Approved.
- [ ] A mandatory rule opens the case automatically, with tasks for the documentation staff and a manager.
- [ ] A passport valid for less than 12 months cannot move to University Application.
- [ ] As MD: approve the Bonafide (Qatar school → Varna) draft under Verification rules. Adding a country offers "Used as"; adding a course offers "Academic details".

## G5. Country-wise requirements and alerts (advisory)

- [ ] Registration form: choosing Bulgaria shows the amber "BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS" notice. Choosing Georgia shows nothing.
- [ ] Profile: the notice compares the recorded marks (Meets / Below requirement / Not recorded). Acknowledge shows "Requirements acknowledged by …".
- [ ] Marks below 60% or missing still let the student move forward (a reminder to acknowledge only), and an "Academic verification" task is created.
- [ ] Admin → Country-wise requirements: add Egypt or Romania requirements, edit them (reason required, new version in the history), deactivate them.
- [ ] An expired passport shows a red CRITICAL banner; less than 12 months shows an amber Passport warning. Registration is not blocked.
- [ ] Dashboard "Priority attention" lists critical counts and notices awaiting acknowledgement. Check on a phone.

## G6. Passport verification and originals by courier (Nov 2026)

- [ ] Passport tab: record a renewal. The profile still shows the old passport, with "New passport awaiting verification". Verify and activate it (as manager or documentation staff); the new passport becomes current. Try a rejection (a reason is required); the old passport stays.
- [ ] A counsellor can record a new passport but cannot verify it. Changing the passport number on the Edit form is refused, with a pointer to the Passport tab.
- [ ] Administration → Courier addresses: enter your real office address (the demo address is marked [DEMO]).
- [ ] Student → Documents → "Originals by courier": only documents with **approved scans** can be chosen. Issue the instructions.
- [ ] Portal (phone): the "Sending your original documents" card appears only now, with the address. Enter the courier company and tracking number.
- [ ] Staff: the courier details appear as "Submitted by the student in the portal". Mark in transit, confirm receipt (the original location becomes "With staff"), and reconcile each document. A mismatch needs a note and creates a task.
- [ ] Reports → Original documents by courier lists open shipments first.

## H. Usability
| # | Test | Expected |
|---|---|---|
| H1 | Use on a phone (Students, profile, tasks) | readable, usable |
| H2 | Keyboard only: login, register a student | possible |
| H3 | Each role completes their daily tasks without training beyond USER_GUIDE.md | collect feedback |

Sign-off: ______________________ (MD)   Date: __________
