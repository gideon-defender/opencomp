# Getting started

## What OpenComp is

OpenComp runs your compliance and security programs in one place:

- **Compliance** — frameworks (SOC 2, ISO 27001, HIPAA, GDPR, …), controls,
  policies, evidence, and audit readiness.
- **People** — employee directory, onboarding, offboarding, training, and
  background checks.
- **Security** — penetration tests, cloud security (AWS, GCP, Azure), and
  device coverage.
- **Trust** — a public Trust Center with access requests and NDAs.
- **Employee portal** — a separate, simpler app where employees accept
  policies, complete training, and manage their devices.

## Signing in

OpenComp uses single sign-on through the Gideon identity service. There are
no OpenComp passwords.

1. Go to your OpenComp URL.
2. Choose **Sign in with Gideon**.
3. Complete sign-in in Gideon. You return to OpenComp with an active session.

If sign-in says you have no access, your Gideon account has no entitlement
for this organization. Ask an administrator to assign you in Gideon — access
cannot be granted inside OpenComp. See [Roles and access](roles-and-access.md).

## Organizations

Everything in OpenComp belongs to an **organization**. The organization name appears in the header. Open organization-specific
links supplied by your administrator and check the name before working.
Changing an organization ID in a URL does not grant access to another tenant.
If the wrong organization opens, ask your Gideon administrator to check your
assignment and sign in again.

## Navigation

After sign-in, open the **Overview** dashboard. The product rail switches
between **Compliance**, **Trust**, **Security**, and **Settings**; the sidebar
then shows pages for that product. Use **Search** (⌘K on macOS) to find work.
The pages available in your deployment can include:

| Section | What it holds |
| --- | --- |
| Overview | Compliance scores, frameworks, policies, tasks at a glance |
| Frameworks | SOC 2, ISO 27001, HIPAA, and other framework instances |
| Policies | Company policies and their approval lifecycle |
| Evidence (Tasks) | Evidence collection work |
| People | Employee directory, candidates, devices, org chart |
| Risk / Vendors | Risk register and vendor register |
| Questionnaire | AI-assisted vendor questionnaires |
| Documents | Company forms and ISO 27001 ISMS documents |
| Knowledge Base (inside Questionnaire) | Curated answers and documents that power AI features |
| Settings → Context | Organization facts used by AI features |
| Security | Penetration tests |
| Cloud tests | AWS, GCP, and Azure security checks |
| Integrations | Connected third-party tools |
| Trust | Trust Center configuration and access requests |
| Settings | Organization configuration |
| Auditor | Read-only auditor view (auditors only) |

Sections may be hidden because of permissions or feature availability. If the whole app shows
"No access", your role has no `app:read` permission (typical for
portal-only employee roles — use the [Employee portal](employee-portal.md)).

![Overview showing compliance progress and framework cards](images/overview-dashboard.png)

*Use the product rail on the left to switch areas; use framework cards to investigate coverage.*

## Core concepts

- **Framework** — a compliance standard (for example SOC 2) activated for
  your organization. Frameworks contain requirements and controls.
- **Control** — a specific safeguard (for example "MFA is enforced"). Controls
  link to the policies, evidence, and tasks that satisfy them.
- **Policy** — a written company policy with a draft → review → published
  lifecycle.
- **Task / evidence** — a unit of compliance work, optionally with attached
  proof.
- **Connection** — a linked third-party account (cloud account, tool
  integration). Connections sync data and evidence automatically.
- **Member** — a person in your organization, synced from Gideon with roles.

## Your first week as an admin

1. Sign in and confirm you see the Overview dashboard.
2. Activate a framework — see [Compliance overview](compliance-overview.md).
3. Review the generated policies, then publish them — see [Policies](policies.md).
4. Connect AWS (or GCP/Azure) — see [Cloud security](cloud-security.md).
5. Invite-free people sync happens from Gideon; verify the directory —
   see [People](people.md).
6. Configure the Trust Center — see [Trust Center](trust-center.md).

## Confirm setup is complete

Open each active framework and check that its policies and evidence have an
owner. Confirm integrations have completed a successful sync or scan, then
check that employees can reach their portal. A framework with 0% coverage
is configured but still needs compliance work.

## Getting help

- This guide (`docs/user-guide/`) for how-to documentation.
- [FAQ](faq.md) for common problems.
- [Glossary](glossary.md) for terms.
