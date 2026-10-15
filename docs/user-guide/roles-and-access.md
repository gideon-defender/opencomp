# Roles and access

## The one rule

**Access is managed in Gideon, not in OpenComp.** Roles, invitations, and
membership changes happen in the Gideon identity service and sync to
OpenComp. OpenComp has no invite buttons, no role editors, and no local
ownership transfer. Screens that used to edit access are read-only and say
so, with guidance to make the change in Gideon.

What this means in practice:

- To give someone access: assign them a role in Gideon.
- To remove someone: remove the assignment in Gideon (and offboard them —
  see [People](people.md)).
- To change a role: change the assignment in Gideon; OpenComp overwrites the
  member's roles on every login and on a five-minute reconciliation schedule.
- A user with no Gideon entitlements cannot sign in at all.

## Built-in roles

| Role | Intended for | Key abilities |
| --- | --- | --- |
| Owner | Company owners | Everything, including deleting the organization |
| Admin | Security/compliance leads | Everything except deleting the organization |
| Auditor | External/internal auditors | Read everything, raise and manage findings; no secrets, no API keys |
| Employee | Staff | Employee portal only (own policies, training, tasks, devices) |
| Contractor | Contractors | Same portal-only scope as employee |

Custom roles can exist with any combination of permissions.

![System Roles and read-only Custom Roles reference](images/roles.png)

*Use View to inspect permissions; change assignments in Gideon.*

## Permissions

Permissions use a `resource:action` format (for example `policy:update`,
`control:read`, `pentest:create`). The resources include:

`organization`, `member`, `control`, `evidence`, `policy`, `risk`, `vendor`,
`task`, `framework`, `audit`, `finding`, `questionnaire`, `integration`,
`apiKey`, `trust`, `pentest`, `app`, `compliance`, `training`, `portal`,
`secret`, `backgroundCheck`.

Notable gates:

- `app:read` — enter the main app at all. Portal-only roles lack it.
- `integration:create` / `update` / `delete` — add, run/scan, and remove
  connections.
- `backgroundCheck:create` — start screenings; `backgroundCheck:read` — view them.
- `secret:*` — manage decrypted credentials (owners/admins only; auditors
  are excluded).
- `apiKey:*` — create and revoke API keys.

Permissions are action-specific; a read permission does not authorize
creating or changing records. See [Automation and API access](automation-and-api.md)
for scoped credentials.

## Sessions and authentication

- Interactive users sign in with Gideon SSO (sessions).
- Automation can use API keys (`x-api-key` header), created in
  **Settings → API Keys**. An API key's abilities equal the scopes selected at
  creation. Keys are shown once — store them securely.
- When access is revoked in Gideon, OpenComp sessions stop working at the
  next reconciliation run (about five minutes), not only at next login.

## If you cannot see something

1. Check your role with an admin.
2. Check the permission listed at the top of the relevant guide.
3. If the whole app says "No access", your role lacks `app:read` — you are
  probably a portal-only user; use the [Employee portal](employee-portal.md).
