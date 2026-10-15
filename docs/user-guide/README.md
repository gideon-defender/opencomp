# OpenComp User Guide

Practical documentation for everyone who uses OpenComp: administrators running
compliance and security programs, and employees completing their own tasks in
the employee portal.

## Who this guide is for

| Reader | Start with |
| --- | --- |
| Organization owner or admin setting up OpenComp | [Getting started](getting-started.md), [Roles and access](roles-and-access.md) |
| Compliance manager (SOC 2, ISO 27001, HIPAA, …) | [Compliance overview](compliance-overview.md), [Policies](policies.md), [Evidence and tasks](evidence-and-tasks.md) |
| Security engineer | [Penetration tests](security-penetration-tests.md), [Cloud security](cloud-security.md), [Background checks](background-checks.md), [Devices](devices.md) |
| People / HR operator | [People](people.md) |
| Employee (non-admin) | [Employee portal](employee-portal.md) |
| Sales / customer trust team | [Trust Center](trust-center.md) |

## Contents

### Foundations

- [Getting started](getting-started.md) — sign in, organizations, navigation, core concepts
- [Roles and access](roles-and-access.md) — roles, permissions, how access is granted (IdP-managed)
- [Organization settings](organization-settings.md) — general, billing, context, API keys, secrets, notifications, portal settings

### Compliance

- [Compliance overview](compliance-overview.md) — dashboard, frameworks, controls
- [Policies](policies.md) — create, approve, publish, and maintain policies (including the AI editor)
- [Evidence and tasks](evidence-and-tasks.md) — collect evidence, assign work, approvals, exports
- [Browser automations](browser-automations.md) — collect recurring evidence from vendor websites
- [Security questionnaires](questionnaires.md) — answer vendor questionnaires with AI
- [Documents and ISMS](documents-isms.md) — company forms, ISO 27001 ISMS, statement of applicability

### People

- [People](people.md) — directory, employee records, onboarding, offboarding, training

### Risk

- [Risk and vendors](risk-and-vendors.md) — risk register, vendor register and reviews

### Security

- [Penetration tests](security-penetration-tests.md) — run and read AI-assisted pentests
- [Cloud security](cloud-security.md) — connect AWS, GCP, and Azure; run checks; remediate; disconnect
- [Background checks](background-checks.md) — screen candidates and employees with Checkr
- [Devices](devices.md) — FleetDM and device-agent coverage

### Trust and integrations

- [Trust Center](trust-center.md) — public trust portal, access requests, NDAs
- [Integrations](integrations.md) — connect third-party tools, manage accounts
- [MCP setup](mcp-setup.md) — hosted and local connections, credentials, verification, troubleshooting
- [MCP worked examples](mcp-examples.md) — list tasks, review frameworks, inspect Trust Center content

### Employee experience

- [Employee portal](employee-portal.md) — policies, training, tasks, devices for employees
- [Browser extension](browser-extension.md) — answer questionnaires inside third-party pages

### Reference

- [FAQ](faq.md)
- [Glossary](glossary.md)

## Conventions used in this guide

- **Permission names** identify access needed for an action (for example,
  `policy:update`). If an action is unavailable, ask an owner or admin to
  check both your permissions and feature availability.
- **Access is managed in your identity provider (Gideon), not in OpenComp.**
  Roles, invitations, and membership changes happen in Gideon and sync to
  OpenComp. See [Roles and access](roles-and-access.md).
- **Screenshots** show the development product captured on October 15, 2026.
  Names, counts, enabled features, and available actions vary by organization.
  Gray blocks labeled “Identity redacted” hide personal information.
- **Availability** depends on your permissions, enabled features, subscription,
  and deployment. A missing feature does not always mean a permission problem.
- **Success checks** explain how to confirm that your work was saved. Never
  treat a generated draft, an empty scan, or an incomplete sync as completion.

## Related documentation

- [Automation and API access](automation-and-api.md) — scoped API keys, MCP, and exports.
- [Documentation maintenance](maintenance/README.md) — screenshot provenance, verification, and remaining capture gaps.
- Developer and API material lives in `packages/docs/` (Mintlify site).
- Implementation plans live in `docs/plans/`.
- Operational runbooks live in `docs/runbooks/`.
