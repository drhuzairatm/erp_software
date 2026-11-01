# Sealed emergency MD account: proposed design (for owner review; NOT created)

**Status:** proposal only (1 Nov 2026). Nothing has been built, created or activated. Implementation needs your approval of this design.

## 1. Purpose
**What it is:** a second account with MD powers, used **only** when the real MD account cannot be used. For example:
- the MD is unavailable in an emergency
- the MD's phone and recovery codes are both lost
- the MD account is suspected compromised and must be locked out

**What it is not:** it is never used for normal work.

## 2. How it differs from a normal account
| Property | Design |
|---|---|
| Identity | A dedicated account, e.g. "Emergency MD (sealed)" with its own email address on the company domain (e.g. `emergency-md@<company domain>`, PENDING OWNER CONFIRMATION). Not tied to a person's daily mailbox. |
| Creation | Only with the database setup tool and the deliberate `--allow-additional-md` override (already built in Phase A). This raises the existing **critical "MD role granted"** alert. |
| Normal state | **Sealed:** the account is *Suspended* with the reason "Sealed emergency account". It cannot sign in, has no sessions, and its password links do not work (existing behaviour of suspended accounts). |
| Password | Long random passphrase generated once at creation (at least 24 characters). Shown once, never stored in the system, never emailed. |
| Two-step login | Authenticator secret set up at creation, then held **offline**:<br>• **Preferred:** a dedicated, switched-off phone kept in a safe.<br>• **Alternative:** a printed QR code / key in the sealed envelope.<br>Plus 10 recovery codes in the envelope. Two-step login is compulsory (existing). |
| Custody (two-person rule) | Two sealed, tamper-evident envelopes in two different safes, held by two **custodians** named by you (PENDING OWNER CONFIRMATION; e.g. a trusted director and the legal adviser):<br>• **Envelope A:** the password.<br>• **Envelope B:** the authenticator phone or QR code, plus the recovery codes.<br>Neither custodian alone can sign in. |
| Unsealing ("break glass") | Done by a **technical owner** with a server command (`npm run emergency:unseal`, to be built). It requires:<br>• the reason<br>• the names of the two custodians who authorised it<br>• a time limit (maximum 24 hours)<br>It sets the account to *Active*, records everything in the audit log and raises a **critical** alert. The real MD account cannot unseal it (it may be the compromised one); a staff member cannot unseal it either. |
| Use | Custodians A and B meet. One signs in with the password and the two-step code. Every action is audited under the emergency account's name like any other user. |
| Alerts | **Critical** security alert on: unseal; **every sign-in** (successful or failed); every 2-step code use; every recovery-code use; re-seal. All are emailed to the MD and the custodians as soon as an email provider is configured. Alerts cannot be edited or deleted (existing). |
| Automatic re-seal | When the time limit ends, the scheduled job suspends the account again and ends its sessions. An alert is raised. |
| After every use | **1.** The MD (or the deputy, if the MD is unavailable) reviews the audit log of everything the account did. **2.** The passphrase and two-step secret are **replaced**: new codes, new envelopes. **3.** The incident note is completed (INCIDENT_RESPONSE_PLAN.md). |
| Limits while unsealed | Same powers as the MD (that is the point), with these exceptions: it cannot unseal itself or extend its own time limit, and it cannot create another MD. |
| Testing | Once a year (or at go-live): a supervised test unseal on **staging**, then re-seal and rotate. Never test on production except in a real emergency. |

## 3. What would need to be built (after your approval)
1. **Database flag:** a small migration marks the account as *emergency*, stores the unseal reason, custodians and expiry, and adds the extra critical alerts (sign-in, codes, unseal, re-seal).
2. **Server commands:** `emergency:unseal` (reason, two custodian names, hours ≤ 24) and `emergency:reseal`. Available only to the technical owner with database access, never through the web app.
3. **Scheduled job:** the existing per-minute job re-seals the account automatically at expiry.
4. **Tests:**
   - sealed → cannot sign in
   - unseal → alerts → sign-in alerts
   - automatic re-seal ends sessions
   - cannot unseal itself
   - cannot create another MD
5. **Procedure:** a one-page runbook (who calls whom, where the envelopes are, how to rotate).

Creating the actual account (generating the passphrase, enrolling the authenticator, sealing the envelopes) happens **only in production** at go-live, with both custodians present.

## 4. Decisions needed from you
| # | Decision | Status |
|---|---|---|
| E1 | Approve this design (or ask for changes) | PENDING OWNER CONFIRMATION |
| E2 | The two custodians (names and roles) | PENDING OWNER CONFIRMATION |
| E3 | Emergency account email address | PENDING OWNER CONFIRMATION |
| E4 | Maximum unseal period (proposed 24 hours) | PENDING OWNER CONFIRMATION |
| E5 | Offline authenticator: dedicated phone in a safe (preferred), or printed QR | PENDING OWNER CONFIRMATION |
| E6 | Who may authorise unsealing if both the MD and a custodian are unreachable (proposed: nobody; wait) | PENDING OWNER CONFIRMATION |
