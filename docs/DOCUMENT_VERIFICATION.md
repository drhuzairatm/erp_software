# Document verification and approval

## Workflow

```
Missing → Uploaded (pending review) → Under review → Verified → Pending manager approval → Approved
                    ↘ Changes required / Rejected  (a new upload starts again)          ↘ Expired
                                                                Approved → Changes required (re-opened by a manager)
```

| Step | Who (default) | Rule enforced by the database |
|---|---|---|
| Upload | counsellors, documentation, visa, managers | Type checked by content (PDF/JPEG/PNG/WebP ≤ 10 MB). Never approves anything. A new version **resets** verification and approval. |
| Record a check | documentation staff, managers (`documents.review`) | Only on the **current** version while uploaded/under review. "Missing" needs a comment; mandatory checks cannot be "not applicable". |
| Mark verified | `documents.review` | Every mandatory check of every applicable rule must be ticked **present** for the current version. |
| Submit for approval | `documents.review` | Only from Verified. |
| Approve | managers (`documents.approve`), MD | Only from Pending approval; **the approver must not be the person who verified or submitted** the document; checks re-validated. Records which file version was approved. |
| Request changes / reject | reviewers; approvers once pending/approved | Reason required. |
| Mark expired | `documents.review` | Only approved documents. |

Status columns can only change through these database functions; direct updates are refused.
Phase D (attestation) will only accept documents whose **approved version is the current version**.

## Verification rules

A rule = document type + optional scope (previous-education country, destination country, university,
course) + a list of checks:

| Check type | Meaning | Detection hint |
|---|---|---|
| Exact phrase | The wording must appear | phrase searched in the PDF text |
| Statement | Same meaning must be present (wording may differ) | phrase searched (hint only) |
| Keywords | All listed words must appear | each keyword searched |
| Manual check | e.g. signature, seal, photo quality | none — visual check |

- A rule applies when **every** scope it sets matches the student; several rules can apply at once.
- Rules start as **drafts** (anyone with `verification.rules.manage`) and take effect only when **approved**
  (`verification.rules.approve`, the MD by default). Approved rules cannot be edited: *Create new version*,
  edit the draft, approve it — the old version is retired with an end date.
- Every verification record stores the rule **version** and the exact requirement text it was checked against.

## Detection is a hint, never a decision

The in-app viewer (pdf.js, served from the portal itself) extracts the text of the PDF **in the reviewer's
browser** and shows where a required phrase or keywords appear ("Found on page 2") and highlights them.
No document is sent to any OCR service. Scanned images contain no text, so they always need a visual
check. Nothing is ticked automatically; the record notes whether the text was detected when the person ticked.

## Records that cannot be changed

- `document_verifications`: student document, file version, rule and rule version, requirement text,
  result, detection hint, comment, staff, timestamp — **append-only** (updates/deletes blocked by triggers,
  even for the database owner). The latest record per check counts.
- `document_reviews`: every status change with who, when, which version, and reason.
- `document_annotations`: comments/highlights linked to a file version and page — append-only.

## Viewing vs downloading

- *View in the portal* (`documents.file.view`): file streamed from the portal; every opening is audited.
- *Download original* (`documents.download`): 60-second signed link; audited separately (`file_download`).
- Note: anyone who can view a file in a browser can, in practice, capture it (e.g. screenshots). Access is
  limited by role and logged; it cannot be made technically impossible.
