# Attestation & apostille workflows (Phase 1)

**Important:** routes describe the company's own procedures. They are not legal advice.
The demo database has three routes marked **[TO CONFIRM]**. They were built from the business brief and
approved **in the demo only**. A production install starts with no routes; the MD enters and approves the real ones.

## Concepts

| Term | Meaning |
|---|---|
| Authority | An office that stamps or attests (e.g. MEA Apostille, UAE MoFA, an embassy). Admin → Attestation routes → Authorities. |
| Route | An ordered list of stages for documents that match its criteria: **destination country** (required), plus optional **document issuing country**, document type, university, **visa application country** and previous-education country. |
| Stage | One step: authority, mandatory or optional, responsible department, whether a reference number or a supporting document is required, expected days, guidance. |
| Attestation | One run of a route for **one specific approved file version** of a student document. It copies the route's stages when it starts, so later route changes do not affect work in progress. |

## Lifecycle of a route

1. A user with `attestation.routes.manage` (System Administrator, MD) creates a **draft**, then adds and reorders stages.
2. A user with `attestation.routes.approve` (**MD only** by default) approves it. From that day it applies.
3. An approved route **cannot be edited** (enforced by the database). To change it, use "Create new version", edit the draft and approve it. Approving retires the previous version.

## Lifecycle of an attestation

1. **Pre-condition (database-enforced):** the document's current version has been verified **and approved by a manager**
   (`status = approved` and `approved_file_id = current_file_id`). OCR or verification on its own is never enough.
2. The review page shows **Ready for attestation** and lists the matching approved routes, most specific first. A user with
   `attestation.process` (Documentation, Manager) chooses one and starts it.
3. Stages are worked **in order** (database-enforced): a stage cannot start or finish while an earlier stage is still open.
   For each stage the user records the reference/tracking number, processing date, comments, responsible staff and supporting documents (stored privately; every access is audited).
4. **Optional** stages can be marked *Not required*, with a reason.
   **Mandatory** stages can only be skipped by a user with `attestation.exception` (Manager), with a reason. The skip is audited (`attestation_exception`).
5. When every stage is finished, the attestation is **completed**: a timeline event is recorded and the `attestation_completed` notification is queued (rules are off by default).
6. If a **new version** is uploaded, or the document loses its approval, any attestation in progress is **cancelled automatically**. The new version must be approved and attested again.

Attestation progress is separate from verification status. A document keeps its "Approved" status, and its attestation shows as
*Ready → Processing n/m → Attested* on the Documents tab, in the portal ("step n of m"), on the dashboard card and in the **Attestation progress** report.

## Permissions

| Permission | Default roles |
|---|---|
| attestation.routes.manage | System Administrator (and MD) |
| attestation.routes.approve | MD only |
| attestation.process | Manager, Documentation (and MD) |
| attestation.exception | Manager (and MD) |

Company isolation applies as everywhere else: attestation records are visible only to users who can see the student.

## Demo routes ([TO CONFIRM])

| Route | Stages |
|---|---|
| Bulgaria – India-issued documents – Apostille | Apostille (India) |
| Bulgaria – UAE-issued documents – Legalisation | UAE Ministry of Education → UAE Ministry of Foreign Affairs → Bulgarian Embassy (UAE) |
| Egypt – India-issued documents | Indian authentication/Apostille → MEA attestation (optional) → Egyptian Embassy in India |

To add these to an existing demo database without a reset: `npm run demo:attestation` (it only inserts records, and refuses non-local databases).

## Database

Migration `0018_attestation_engine.sql`; undo script `db/rollbacks/0018_attestation_engine.down.sql`.
Tables: `attestation_authorities`, `attestation_routes`, `attestation_route_stages`, `document_attestations`,
`document_attestation_steps`, `attestation_step_files`. All changes to work records go through `app.start_attestation`,
`app.attestation_step_action` and `app.cancel_attestation`. Direct updates are refused, even for the database owner.
New student field: `visa_application_country_id`. New document types: Birth Affidavit, Sponsor Affidavit, Police Clearance Certificate.
