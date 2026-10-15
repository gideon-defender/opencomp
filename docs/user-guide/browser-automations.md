# Browser automations

Collect recurring screenshots from vendor websites when an API integration
cannot provide the evidence you need. Your organization must have browser
automations enabled and you need access to the evidence task and connection.

## Choose the right collection method

Use an [integration](integrations.md) for structured data from a supported
provider. Use browser evidence for a specific page or setting in a web
console. Use a manual attachment for a one-off record you already have.

An automation has a vendor connection, capture instructions, an optional
pass/fail check, and a schedule. Connections can be reused by evidence tasks
in the same organization.

## Connect a vendor

1. Open an [evidence task](evidence-and-tasks.md) and find **Browser evidence**.
   Where available, connections can also be managed under
   **Settings → Browser connections**.
2. Enter the vendor's sign-in URL and choose the offered sign-in method.
3. For a stored login, complete the detected fields. Use a dedicated account
   with only the access needed to read the evidence.
4. For SSO, finish the identity-provider steps in the live browser. Take over
   when a prompt requires your involvement, then return control.
5. Confirm the connection reaches the intended organization and page.

If authenticator support is offered, the **setup key** is the enrollment
secret used to generate codes, not the rotating six-digit code. Follow your
organization's credential policy before storing it. Enter credentials only
in the connection flow, never in task descriptions or capture instructions.

## Create and test browser evidence

1. Describe the destination and required proof precisely. For example:
   “Open organization security settings and capture whether MFA is required
   for all members.”
2. Add a pass/fail criterion if you want evaluation, such as “MFA is required
   for every member.” Without a criterion, review the captured screenshot.
3. Test the automation and watch the live run. Intervene if a login or
   navigation step needs a person.
4. Inspect the screenshot. Check the organization, setting, timestamp, and
   whether the evidence actually supports the stated criterion.
5. Save the automation and review the task frequency. Run it on demand when
   you need updated proof.

## Review recurring runs

Open the automation's run history and inspect the latest result. A successful
navigation does not guarantee that the control passed. Review the evaluation
and evidence together, and attach or reference the result in the task's
review process.

Stored-login connections may renew automatically when supported. SSO sessions
can require manual reconnection. Keep an owner responsible for expired or
failed connections so scheduled collection does not remain stale.

| Symptom | Next step |
| --- | --- |
| Sign-in fails | Check the connection, account status, and vendor's current login requirements. |
| A human prompt appears | Take over in the live browser and finish the required step. |
| Screenshot shows the wrong page | Make the capture instructions more specific and test again. |
| Evidence is stale | Check the task frequency and latest run, then renew the connection if needed. |
| Evaluation fails | Read the result, verify the actual vendor setting, and correct the control or criterion. |

Related: [Evidence and tasks](evidence-and-tasks.md),
[Integrations](integrations.md), [Organization settings](organization-settings.md).
