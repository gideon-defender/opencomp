# FAQ

## Access

**I can't sign in / it says I have no access.**
Your Gideon account has no entitlement for this organization. Ask an admin
to assign you in Gideon. Nothing in OpenComp can grant access.

**I signed in but see "No access" everywhere.**
Your role lacks `app:read` — you are likely a portal-only employee or
contractor. Use the [Employee portal](employee-portal.md).

**A button described in this guide is missing.**
Check the action permission, enabled feature, and subscription with an
owner or admin. Availability also depends on your deployment. This is especially common for destructive actions, which
need `delete` permissions and are hidden — not disabled — without them.

**The questionnaire URL returns “Page not found”.**
Ask your administrator whether questionnaires are enabled in this deployment.
Repeated sign-in will not enable an unavailable route.

**The employee portal cannot be reached.**
Verify the portal URL with your administrator. If the browser reports a DNS
error, report the hostname and error; this occurs before sign-in.

## People

**How do I invite someone?**
You don't — there are no invites in OpenComp. Access and roles are assigned
in Gideon and sync automatically.

**Someone left. What do I do?**
Set their offboard date to open the offboarding checklist, revoke access
per integration, collect devices, and remove the assignment in Gideon. See
[People](people.md).

**Why is a profile read-only?**
Profile data syncs from Gideon. Change it there.

## Compliance

**Which policies count for the audit?**
Only published, non-archived policies. Drafts and in-review policies don't
count toward coverage or employee attestation.

**The AI's questionnaire answers look wrong.**
The AI answers from published policies and the knowledge base. Publish
first, feed the knowledge base, then review every answer. See
[Security questionnaires](questionnaires.md).

**An automation keeps failing.**
Read the run's evaluation result — it names the cause. Fix the underlying
gap or the automation's configuration; don't just re-run.

## Security

**A cloud scan reports permission errors.**
Add the named permissions to the cloud role and re-run. Persistent errors
are findings, not tooling noise. See [Cloud security](cloud-security.md).

**Can I remove a connected cloud account?**
Yes — open its settings and Disconnect (needs `integration:delete`).
History stays for the audit trail.

**Cloud tests show zero results. Is the account secure?**
Zero results alone does not establish security. Check account selection,
enabled services, last completed scan, and permission errors.

**Penetration tests shows “No active plan”.**
Ask your billing administrator to enable the feature and confirm allowance.
Read access alone does not enable scans.

**A penetration test failed.**
Open the failure detail, fix the target or configuration issue, and re-run.

## Trust

**A customer asks for our certifications.**
Send them to the Trust Center first. Gate only what must be gated. See
[Trust Center](trust-center.md).
