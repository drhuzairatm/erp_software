# Country rules

## Countries a student is linked to

| Field | Where | Used for |
|---|---|---|
| Previous education country | student | which mandatory wording certificates must contain (e.g. Bonafide) |
| School / institution country | student | defaults to the previous education country |
| Certificate issuing country | each document | attestation/apostille route (Phase D) |
| Passport issuing country | student (passport permission) | identity |
| Destination country | student | workflow stages, required documents, attestation route |

These are never treated as the same field.

Countries are configured under **Company settings** with two flags: *destination* (appears in the
destination list) and *previous-education country* (listed first for education fields).

## Rules by country

Mandatory wording and checks per country are configured as **verification rules** (see
DOCUMENT_VERIFICATION.md) scoped by previous-education country and/or destination, university, course.

### Current (placeholder) rules — must be replaced

| Rule | Applies to | Checks |
|---|---|---|
| [PLACEHOLDER] Bonafide – educated in India | Bonafide certificate, educated in India | phrase "eligible to pursue higher education in India and abroad"; signed and sealed; (optional) keywords |
| [PLACEHOLDER] Bonafide – educated in Qatar | … educated in Qatar | phrase "… in Qatar and abroad"; signed and sealed |
| [PLACEHOLDER] Bonafide – educated in UAE | … educated in UAE | phrase "… in UAE and abroad"; signed and sealed |
| [PLACEHOLDER] Passport – basic checks | Passport, all students | name/DOB match; validity ≥ 18 months |
| [PLACEHOLDER] Plus Two certificate | Plus Two, all students | marks and board seal visible |

These exist only in the **demo data** to show how the engine works. The wording is illustrative, not legal
advice. Production starts with no rules: the MD (or delegate) enters the approved wording and approves it.

### To add a country's rule
1. Company settings → make sure the country exists (and is flagged as a previous-education country).
2. Verification rules → *New rule* → document type + "Previous education country" → add the exact
   approved phrase(s) and manual checks → MD approves.
