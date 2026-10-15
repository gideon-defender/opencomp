# Background checks

Screen job candidates and employees through Checkr. Starting screenings
requires `backgroundCheck:create`; viewing them requires
`backgroundCheck:read`.

## Setup (owner/admin)

1. Enable the background-check step in **People → Settings**.
2. Make sure the organization has a payment method for screening billing.
3. Configure the Checkr account in **Integrations → Checkr → Configure
   Checkr** (account ID, environment, package, API key). The key is stored
   encrypted and never shown again.

## Screen a candidate

Candidates are people who are not employees yet — no account is created and
no access is granted by screening.

1. Open **People → Candidates**.
2. Click **Start background check** and enter the candidate's details.
3. Checkr emails the candidate a hosted consent link. Status shows as
   invitation sent, then progresses as Checkr reports back.
4. Track progress in the screenings table.

A clear completed check creates an identity record. Flagged results never
create identities, and screening alone never grants OpenComp access — access
is assigned separately in Gideon.

## Screen an employee

1. Open the employee record → **Background Check** tab.
2. Fill in the order form (the contact email is used for consent; notes stay
   internal).
3. Monitor status, report, and audit timeline from the same tab.
4. To attach an outside report instead (Checkr, Sterling, or other), use the
   attach form.

Members marked exempt skip the background-check step.

## Confirm the screening was submitted

After submitting, verify a screening record or invitation status appears
for the intended person. A sent invitation is not a completed report. If
status is unclear, check the record and provider integration before placing
another order. Charges and candidate emails may result from duplicate orders.

If the Candidates tab cannot load, ask your administrator to check Checkr
configuration and service availability. Do not treat an empty or failed
view as proof that no screening exists.

## Practical guidance

- Screening is a hiring control, not access provisioning. Keep the two
  decisions — and their approvers — separate.
- Exemptions should be rare, named, and time-boxed.
- Keep the audit timeline exportable for personnel files.
