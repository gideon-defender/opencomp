# Maintaining the user guide

This is an editorial record, separate from the customer instructions.

## Checkr documentation follow-up — October 17, 2026

**Pending Checkr configuration:** expand the user manual’s Background checks
section after the integration is configured and the candidate flow can be
verified live. Keep this follow-up in maintenance notes, outside the
customer-facing manual.

The candidate load-error screenshot, failure commentary, and unverified
candidate-provisioning description were removed from the manual at the user’s
request. The [earlier error capture](../images/manual/candidate-load-error.png)
is retained here as an internal record, not a user instruction.

When Checkr is ready:

- Walk the candidate flow using approved sandbox data: start a screening,
  candidate consent/invitation, status tracking, and completed-result review.
- Capture the working screens from the product and replace the error example
  with a step-by-step walkthrough and clear success checks.
- Verify what a completed or flagged result actually does. Confirm identity
  provisioning and access assignment behavior before documenting either;
  do not restore the removed provisioning claims without evidence.
- Confirm billing, duplicate-order handling, permissions, and the employee
  record flow. Expand the section from those verified results.

## Verification status — October 15, 2026

The guide covers the product areas represented in this branch. Screenshots
were taken through native Chrome controls from the existing authenticated
development session. The deployment differs from this branch in navigation
and feature availability. **Full-product live acceptance is still pending.**
The unavailable workflows below must be checked before claiming complete
production verification or publishing a fully illustrated edition.

No paid scan, screening order, policy publication, message, credential
creation, access change, or production data edit was performed for captures.
Blank creation forms were opened and dismissed. Chrome's product tab was
returned to Overview after capture.

| Area | Evidence obtained | Remaining acceptance work |
| --- | --- | --- |
| Getting started | Live Overview and navigation | Capture sign-in using a separate signed-out demo session. |
| Frameworks | Live list and SOC 2 controls | Exercise framework creation and update with disposable demo data. |
| Policies | Live list, Overview, and Content inspection | Capture approval, published version, and AI suggestion with approved demo content. |
| Evidence | Live list, task settings, comments, and attachment controls | Verify a disposable upload, completion, and export. |
| Documents | Live Overview and document categories | Capture submitted form and completed statement of applicability. |
| People | Live directory, identity-sync notice, and device empty state | Capture a synthetic employee's details, training, and offboarding. |
| Background checks | Candidates tab returned “Could not load candidate screenings.” | Restore Checkr access and capture sandbox configuration and screening statuses. |
| Devices | Live empty-state capture | Capture enrolled synthetic devices and policy results. |
| Risks and vendors | Live creation forms; register fields inspected | Capture synthetic assessment, treatment, and review outcomes. |
| Integrations | Live catalog and provider availability | Capture a demo connection's details and successful sync. |
| Cloud tests | Live providers, account selection, results controls, and Add Cloud | Capture nonempty findings, permission error, remediation review, and disconnect using demo accounts. |
| Trust | Live configuration, access requests, public portal, and visitor form | Public development portal and blank visitor request form captured; NDA approval/revocation still needs synthetic visitors. |
| Settings and roles | Live general, roles, portal toggles, API-key form, and context form | Verify notifications, billing, secrets, and user preferences with sanitized demo data. |
| Penetration tests | Live “No active plan” entry screen | Use an entitled demo organization for profile, run, finding, report, and retest captures. Preview scans are not real runs. |
| Questionnaires | Route returned 404; branch source inspected | Enable the feature in a matching deployment; capture upload, review, knowledge base, and export. |
| Employee portal | Documented hostname returned DNS_PROBE_FINISHED_NXDOMAIN | Confirm a working portal URL; capture a synthetic employee's policy, training, forms, and devices. |
| Browser extension | Existing extension documentation reviewed | Use a connected extension and synthetic questionnaire page for detection, review, and insertion. |
| Browser automations | Existing guide and task components reviewed | Capture a sanitized connection, test run, evaluation, and history. |
| API/MCP | Live hosted handshake, 406-tool discovery, task/framework reads, missing-key rejection, and local stdio read | [Connection check](mcp-connection-check.md); interactive client and full release acceptance remain separate. |

## Source checks

When live acceptance was unavailable, descriptions were checked against the
branch's feature implementation or the existing product guides. These checks
support editing; they do not substitute for end-to-end workflow verification.

- Questionnaire upload accepts PDF, XLSX, and CSV, one file up to 100 MB:
  [QuestionnaireUpload](../../../apps/app/src/app/\(app\)/[orgId]/questionnaire/components/QuestionnaireUpload.tsx).
- Knowledge Base is inside Questionnaire:
  [QuestionnaireTabs](../../../apps/app/src/app/\(app\)/[orgId]/questionnaire/components/QuestionnaireTabs.tsx).
- Creating a penetration-test run requires `pentest:create`:
  [API controller](../../../apps/api/src/security-penetration-tests/security-penetration-tests.controller.ts).
- Framework creation requires `framework:create`:
  [framework controller](../../../apps/api/src/frameworks/frameworks.controller.ts).
- Browser collection workflow:
  [existing browser guide](../../../packages/docs/browser-automations.mdx).
- Extension session, Sheets mapping, and Docs clipboard behavior:
  [existing extension guide](../../../packages/docs/security-questionnaire-extension.mdx).

## Image provenance and privacy

[manifest.json](../images/manifest.json) records capture date, environment,
original crop rectangles, redactions, and output size. Images are real screen
captures; no UI elements, statuses, or sample results were fabricated.

Chrome tabs, address bars, and bottom status overlays were cropped away.
Personal identities were covered with opaque labeled rectangles in the People
and Access Requests captures. Risk, vendor, context, and key forms were
cropped to the form alone so underlying records are excluded. Internal policy
body text was not included in the final assets. Empty states and the plan
gate are captioned as such.

The user confirmed Checkr and penetration testing are not yet enabled. Those
run captures are intentionally deferred. The supplied development Trust Center
was inspected; its Security questionnaire button opens the access-request
form with a pre-filled purpose. No request was submitted.

Raw captures remain outside the repository in the temporary capture directory.
Do not publish raw captures. Inspect every replacement at readable size for
credentials, private identities, account IDs, infrastructure details, and
customer content before adding it. Never reveal a secret for an illustration.

## Refresh workflow

1. Use an approved demo tenant with synthetic employees and documents.
2. Match the branch, deployment version, role, feature flags, and subscription.
3. Navigate through the real workflow. Capture only settled, representative
   screens; do not use loading or error states as successful examples.
4. Crop to the relevant content, preserve readable labels, and redact private
   data with opaque blocks. Do not invent product behavior in an image editor.
5. Save PNGs in `images/`, update the manifest, and embed with descriptive alt
   text and a caption explaining what the reader should observe.
6. Verify every relative link and image, and review the rendered Markdown.
7. Clear the corresponding acceptance gap only after the workflow and its
   output have been checked live.

Run the offline integrity check from the repository root:

```sh
python3 docs/user-guide/maintenance/check_guides.py
```

Validate the executable MCP examples as well:

```sh
pnpm --filter @gideon-defender/mcp-server exec node --import tsx --test ../../docs/user-guide/maintenance/check_mcp_examples.mjs
```

The MCP check uses the actual CLI and MCP runtime with a fake API and fake key.
It checks documented inputs, HTTP paths and query values, validation errors,
and static/dynamic discovery without network access. It also checks that the
Mintlify MCP pages match the repository setup and examples. Keep both editions
aligned; the hosted URL documented here is development, not a production URL.
The optional relation/score examples have runtime coverage against a mock API;
the base read examples also have the separate recorded live connection check.

The integrity check validates local links and anchors, image references and manifests,
image readability, missing alt text, and unfinished screenshot markers. It
does not certify product behavior. This section is repository Markdown; no
Mintlify publication or external deployment is part of this change.
