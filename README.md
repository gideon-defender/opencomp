<!-- PROJECT LOGO -->
<p align="center">
  <a href="https://github.com/gideon-security/opencomp">
   <img src="https://www.gideondefender.com/gideon.png" alt="Logo" width="10%">
  </a>

  <h3 align="center">Gideon Defender OpenComp </h3>

  <p align="center">
    The open-source compliance platform.
    <br />
    <a href="https://gideondefender.com"><strong>Learn more »</strong></a>
    <br />
    <br />
    <a href="https://gideondefender.com">Website</a>
    ·
    <a href="https://gideondefender.com/docs">Documentation</a>
    ·
    <a href="https://github.com/gideon-security/opencomp/issues">Issues</a>
    ·
    <a href="https://gideondefender.com/roadmap">Roadmap</a>
  </p>
</p>

<p align="center">
   <a href="https://github.com/gideon-security/opencomp/stargazers"><img src="https://img.shields.io/github/stars/gideon-security/opencomp" alt="Github Stars"></a>
   <a href="https://github.com/gideon-security/opencomp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPLv3-purple" alt="License"></a>
   <a href="https://github.com/gideon-security/opencomp/pulse"><img src="https://img.shields.io/github/commit-activity/m/gideon-security/opencomp" alt="Commits-per-month"></a>
   <a href="https://github.com/gideon-security/opencomp/issues"><img src="https://img.shields.io/badge/Help%20Wanted-Contribute-blue"></a>
</p>

## About

### AI that handles compliance for you in hours.

OpenComp is the fastest way to get compliant with SOC 2, ISO 27001, HIPAA, GDPR and other regulatory frameworks. OpenComp automates evidence collection, policy management, and control implementation while keeping you in control of your data and infrastructure.

## Documentation

- [User guide](docs/user-guide/README.md) — end-user documentation for
  administrators, compliance and security teams, and employees: getting
  started, roles and access, compliance, people, risk and vendors, security
  testing, Trust Center, integrations, the employee portal, FAQ, and glossary.
- [Hosted documentation](https://gideondefender.com/docs) — guides, cloud
  test references, integration guides, and API reference.
- [API reference](packages/docs/api-reference/overview.mdx) — generated
  OpenAPI reference (`packages/docs/openapi.json`).

### Built With

- [NestJS](https://nestjs.com/?ref=gideondefender.com)
- [Next.js](https://nextjs.org/?ref=gideondefender.com)
- [PostgreSQL](https://www.postgresql.org/)
- [Prisma](https://prisma.io/?ref=gideondefender.com)
- [Redis](https://redis.io/)
- [Tailwind CSS](https://tailwindcss.com/?ref=gideondefender.com)

## Candidate background checks

People starts Checkr-hosted candidate screenings without creating local users,
assigning roles, or sending Employee Portal invitations. Configure a separate
Checkr account and encrypted credentials for each tenant; see the
[candidate intake setup and recovery guide](docs/checkr-candidate-intake.md).

Use **Start background check** to submit a candidate's name, email, and work
location. The tenant needs a configured Checkr connection, background-check
allowance or credits, and a running local Trigger worker. Deploying alone does
not configure the connection. The **Candidates** tab tracks invitation dispatch;
an invitation sent does not indicate a completed check or a provisioned account.
Completion webhooks and Gideon identity provisioning are outside this flow.

### People directory troubleshooting

The People directory reads memberships for the organization in the page URL.
Roles come from `Member.role`, synchronized from OIDC entitlements;
`User.role` is no longer part of the database schema. If API logs show
`Unknown field role ... on model User`, deploy the API fix that removes that
field from the directory query, together with the app fix that displays failed
reads as an error. A failed request must not appear as a successfully empty
directory. Check `GET /v1/people?includeDeactivated=true` with the matching
`X-Organization-Id` before changing or recreating accounts.

## Contact us

Contact our team at info@gideondefender.com to learn more about how we can help you achieve compliance.

## Stay Up-to-Date

Get access to the cloud hosted version of [OpenComp](https://www.gideondefender.com/en/products/open-source/opencomp/).

## Getting Started

To get a local copy up and running, please follow these simple steps.

### Prerequisites

Here is what you need to be able to run OpenComp.

- Node.js (Version: >=22.x)
- npm (Version: >=10.x)
- Docker (Version: >=24.x) or Podman (Version: >=5.x)
- Postgres with PgVector (Version: >=15.x)
- A Gemini API key (for AI-powered onboarding — free tier works, but has a low daily request cap)

## Development

To get the project working locally with all integrations, follow these extended development steps

### Setup

## Add environment variables and fill them out with your credentials

```sh
cp apps/app/.env.example apps/app/.env
cp apps/portal/.env.example apps/portal/.env
cp packages/db/.env.example packages/db/.env
```

## Get code running locally

1. Clone the repo

```sh
git clone https://github.com/gideon-security/opencomp.git
```

2. Navigate to the project directory

```sh
cd opencomp
```

3. Install dependencies using pnpm (v10+, managed via `packageManager` — corepack activates the pinned version)

```sh
pnpm install
```

4. Get Database Running

```sh
cd packages/db
pnpm run docker:up # Spin up docker container
pnpm run db:migrate # Run migrations
```

5. Generate Prisma Types for each app

```sh
cd apps/app
pnpm run db:generate
cd ../portal
pnpm run db:generate
cd ../api
pnpm run db:generate
```

6. Run all apps in parallel from the root directory

```sh
pnpm run dev
```

---

### Environment Setup

Create the following `.env` files and fill them out with your credentials

- `opencomp/apps/app/.env`
- `opencomp/apps/portal/.env`
- `opencomp/apps/api/.env`
- `opencomp/packages/db/.env`

You can copy from the `.env.example` files:

### Linux / macOS

```sh
cp apps/app/.env.example apps/app/.env
cp apps/portal/.env.example apps/portal/.env
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env
```

### Windows (Command Prompt)

```cmd
copy apps\app\.env.example apps\app\.env
copy apps\portal\.env.example apps\portal\.env
copy apps\api\.env.example apps\api\.env
copy packages\db\.env.example packages\db\.env
```

### Windows (PowerShell)

```powershell
Copy-Item apps\app\.env.example -Destination apps\app\.env
Copy-Item apps\portal\.env.example -Destination apps\portal\.env
Copy-Item apps\api\.env.example -Destination apps\api\.env
Copy-Item packages\db\.env.example -Destination packages\db\.env
```

Additionally, ensure the following required environment variables are added to `.env` in `opencomp/apps/app/.env`:

```env
AUTH_SECRET=""                  # Use `openssl rand -base64 32` to generate
DATABASE_URL="postgresql://user:password@host:port/database"
REDIS_URL="redis://localhost:6379"  # Shared by the kv layer and BullMQ
GOOGLE_GENERATIVE_AI_API_KEY="" # Gemini — powers AI onboarding (https://ai.google.dev/api-keys)
NEXT_PUBLIC_PORTAL_URL="http://localhost:3002"
REVALIDATION_SECRET=""         # Use `openssl rand -base64 32` to generate
```

> ✅ Make sure you have all of these variables in your `.env` file.
> If you're copying from `.env.example`, it might be missing the last two (`NEXT_PUBLIC_PORTAL_URL` and `REVALIDATION_SECRET`), so be sure to add them manually.

Some environment variables may not load correctly from `.env` — in such cases, **hard-code** the values directly in the relevant files (see Hardcoding section below).

---

### Cloud & Auth Configuration

#### 1. OIDC login

Sign-in is handled by the external OIDC identity provider (currently Gideon) — there is
no per-developer OAuth client setup. Legacy logins (Google/GitHub/Microsoft
social, magic link) were removed; their `AUTH_*` variables no longer exist.

The API needs an OIDC client registration (ask the auth team for the
per-environment client ID). Configure it in `opencomp/apps/api/.env` (see the
documented `OIDC_*` block in `apps/api/.env.example`). `GIDEON_OIDC_*` names
remain as deprecated compatibility aliases. Login, logout, and the registered
callback use `/v1/auth/oidc/*`; `/v1/auth/gideon/*` remains a route alias.
New login state uses the Redis prefix `app:oidc:`. Callback readers still accept
`app:gideon-oidc:` state from earlier releases. Keep both registered callback
URLs, route aliases, and state readers through the rollout and rollback window.

```env
OIDC_ISSUER_URL=""    # Provider base URL for OIDC discovery
OIDC_CLIENT_ID=""     # e.g. opencomp-local (registered with auth team)
OIDC_REDIRECT_URI=""  # e.g. http://localhost:3333/v1/auth/oidc/callback
# OIDC_CLIENT_SECRET="" # only for confidential apps; public apps use PKCE
```

#### 2. OIDC entitlements and access management

Org membership is moving from locally managed roles to IdP-owned
entitlements: the Gideon identity service decides who holds which role name,
OpenComp syncs it into `Member.role` at login and, when enabled, reconciles it
between logins. Permission definitions in `packages/auth/src/permissions.ts`
remain the source of truth for what each role can do.

Configure access in Gideon identity cockpit: link the OpenComp OAuth client to
the tenant's application, define application roles with entitlement values, and
assign those roles to users or groups. Entitlement values must match OpenComp
role names: `owner`, `admin`, `auditor`, `employee`, `contractor`, or an existing
custom role in that organization. Multiple values grant multiple roles; the
verified claim `entitlements: ["owner", "admin"]` grants both roles. Group
assignments must satisfy Gideon's governance review requirements; expired or
disallowed assignments do not emit entitlements.

With enforcement enabled, an empty claim or one with no recognized role denies
login without issuing a new session. Valid claims synchronize the membership
with `roleSource='sso'`. Entitlements control user access; they do not enable
organization products or configure integration OAuth credentials.

With both enforcement controls unset, the default is **audit mode**: logins
evaluate the verified ID-token `entitlements` claim and log what enforcement
_would_ do, then mint sessions as before. Configure enforcement explicitly
(the corresponding `GIDEON_*` keys remain deprecated aliases):

```env
# Pilot enforcement (comma-separated tenant IDs).
# This allowlist applies only when all-tenant mode is off.
OIDC_ENFORCEMENT_TENANTS=""
# Enforce all tenants, including future provisioned organizations; takes precedence.
OIDC_ENFORCEMENT_ALL_TENANTS=false
# Bootstrap gate (deny unknown-tenant setup without a verified IdP
# `owner` assignment). Enable only after IdP provisioning seeds an owner per
# new tenant — otherwise new signups brick.
OIDC_BOOTSTRAP_ENFORCED=""  # set to "true" to enable
```

Login enforcement supports pilot tenant scope or all-tenant scope. Reconciliation
runs every five minutes when enabled. Deprecated local access-management
endpoints remain fenced; manage IdP-owned assignments in the identity provider.
Bootstrap remains a separate gate that requires IdP owner provisioning.

Set `OIDC_ENFORCEMENT_ALL_TENANTS=true` to enforce every identified tenant.
Unknown tenants are denied until their OpenComp organization exists; this mode
does not enable self-service owner bootstrap. Existing local memberships must
be converted using verified IdP assignments before expanding enforcement.
Deprecated local membership and role-assignment mutations return `410 Gone`.
Manage IdP-owned assignments in identity cockpit. OpenComp custom-role definition
editing does not grant a user an IdP assignment.

For all-tenant enforcement and between-login reconciliation, configure both:

```env
OIDC_ENFORCEMENT_ALL_TENANTS=true
OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED=true
```

The all-tenant flag takes precedence over the pilot allowlist. To return to
pilot scope, set it to `false` and retain the allowlist. Clearing both controls
returns login to audit mode and removes reconciliation scope; neither rollback
restores revoked roles or deleted sessions.

Between-login reconciliation processes only SSO-owned memberships in
`OIDC_ENFORCEMENT_TENANTS`, or discovers all organizations each run when
`OIDC_ENFORCEMENT_ALL_TENANTS=true`. It reads fresh, complete entitlements
from Gideon Auth's dedicated client-scoped reader, overwrites cached roles, and revokes
tenant-scoped sessions when no valid role remains. Role changes, session
deletion, and audit records commit together. Independent HR offboarding fields
remain unchanged; restoring IdP entitlements cannot reactivate an HR-offboarded
member. Reader failures retain last-known access and fail the job.

Restoring an entitlement clears IdP revocation but does not recreate a deleted
session: the user must perform a fresh OIDC login.

Configure the API/local Trigger worker through the deployment's secret store:

```env
OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED=false # enable after reader preflight
OIDC_ENTITLEMENTS_READER_URL=https://gideon.dev.gideondefender.com
OIDC_ENTITLEMENTS_READ_TOKEN="" # dedicated reader secret; never commit it
OIDC_ENTITLEMENTS_PAGERDUTY_ROUTING_KEY="" # required unless dev explicitly opts out
# OIDC_CLIENT_ID pins the app; enforcement controls define tenant scope.
```

Gideon Auth must receive the same secret as `ENTITLEMENTS_READ_TOKEN`, with
`ENTITLEMENTS_READ_CLIENT_ID` pinned to OpenComp's OAuth client ID. Dev may
explicitly skip PagerDuty using both `GIDEON_ENVIRONMENT=dev` and
`OIDC_ENTITLEMENTS_SKIP_PAGING=true`; failures still log and fail the task.
Other environments require a PagerDuty routing key. Disable future polling with
`OIDC_ENTITLEMENTS_RECONCILIATION_ENABLED=false`; this does not undo recorded
revocations or restore deleted sessions.

**Reconciliation acceptance (2026-10-13):** the recorded inventory contained only
bootstrap tenant `00000000-0000-0000-0000-000000000001`, with paging disabled in dev.
This is historical acceptance evidence, not the current deployment inventory.
The separate Gmail account completed a real auditor login; removing its test
assignment caused the next scheduled run to revoke its retained session, and
refreshing the original browser window denied access. Restoring its auditor
assignment restored the membership on a scheduled run before a fresh login;
the deleted session stayed invalid, and the fresh login accessed the dashboard
and protected API. The protected account retained `owner` and `admin`, and its
existing session still accessed the protected API. Captured HR fields stayed
unchanged. See the reconciliation runbook for audit evidence and the remaining
HR-offboarded restoration and outage/paging acceptance checks.

Operator docs: [delivery plan](docs/plans/2026-10-11-idp-owned-user-management.md),
[entitlements takeover](docs/plans/2026-10-11-oidc-entitlements-takeover.md),
[reconciliation configuration and acceptance runbook](docs/oidc-entitlement-reconciliation.md),
[IdP user-management runbook](docs/runbooks/idp-user-management.md).
Cutover tooling: `scripts/phase0-idp-conversion-inventory.mjs` (read-only
inventory) and `scripts/phase1-pilot-conversion.mjs` (dry-run by default,
`--apply` converts one tenant). Convert existing local memberships before
extending the allowlist or enabling all-tenant mode; reconciliation does not
convert local memberships itself.

#### 3. Redis

Redis is configured via the `REDIS_URL` environment variable (regular Redis —
no Upstash required):

```
REDIS_URL="redis://localhost:6379"
```

The `@gideon-defender/kv` package and the local BullMQ trigger runtime both
read this variable. Optional hardening: `LOCAL_TRIGGER_REDIS_URL` points at a
full-access (`comp_service`) Redis role for BullMQ, falling back to
`REDIS_URL` when unset.

---

### Integration OAuth Configuration

OpenComp supports one shared OAuth app per provider and environment for GCP,
Azure, GitHub App, GitHub OAuth App, Aikido Security, Google Workspace, Rippling,
and Vercel. Customers authorize separately; their tokens and account selections
remain isolated in organization-scoped connections. AWS uses IAM role assumption
and does not require an OAuth app.

#### 1. Callback URL

Register the API callback URL in each provider's app registration:

```
{BASE_URL}/v1/integrations/oauth/callback
```

`BASE_URL` is the API's public URL. The dev callback is:

```text
https://opencomp-api.dev.gideondefender.com/v1/integrations/oauth/callback
```

Locally, use `http://localhost:3333/v1/integrations/oauth/callback`. The
organization-scoped `GET /v1/integrations/oauth-apps/setup/:providerSlug` endpoint
returns the configured callback URL, required scopes, and setup instructions.

#### 2. Provider setup

| Cloud           | Auth                           | What to configure                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS (`aws`)     | IAM role assumption (no OAuth) | Nothing platform-wide. Each connection renders its own CloudShell script with a per-connection external ID — run it in the target account.                                                                                                                                                                                                                                                      |
| GCP (`gcp`)     | OAuth2                         | Google Cloud Console → **APIs & Services → Credentials** → **OAuth client ID** (Web application), with the callback URL above in **Authorized redirect URIs**. Actual access is limited by IAM roles — connecting users only need read-only roles like `roles/securitycenter.findingsViewer`.                                                                                                   |
| Azure (`azure`) | OAuth2                         | Azure Portal → **App registrations** → **New registration**, account type **Accounts in any organizational directory** (multitenant), with the callback URL above as a **Web** redirect URI. Then **Certificates & secrets** → new client secret. Actual access is controlled by Azure RBAC — connecting users need at least **Reader** (plus **Security Reader** for Defender for Cloud data). |

| Additional provider                   | Shared app setup                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub App (`github-app`)             | Create a GitHub App installable on **Any account**. Enable OAuth during installation, configure read-only permissions from the manifest, and disable webhooks if unused. Store its **Client ID** and **Client Secret**, with `customSettings.githubAppSlug` set to the app's public slug. Current token handling requires **Expire user authorization tokens** to be disabled. |
| GitHub OAuth App (`github`)           | Register an OAuth App with the callback URL. Use its own client credentials, separate from `github-app`. The integration requests `read:org`, `repo`, and `read:user`.                                                                                                                                                                                                         |
| Aikido Security (`aikido`)            | Create a **Public** OAuth app with the callback URI for customer workspace consent. Private workspace client credentials are not a shared customer-consent app.                                                                                                                                                                                                                |
| Google Workspace (`google-workspace`) | Configure an **External** Google OAuth app, enable Admin SDK, and approve the manifest's directory read scopes. Each customer's Workspace admin authorizes it. This provider has its own credential row, separate from `gcp`.                                                                                                                                                  |
| Rippling (`rippling`)                 | Register a partner OAuth app, enable worker read access, and set `customSettings.appName` to the app's URL name.                                                                                                                                                                                                                                                               |
| Vercel (`vercel`)                     | Register a Vercel integration and set `customSettings.appSlug` to its integration slug. Each installation has its own account/team context.                                                                                                                                                                                                                                    |

##### Azure organizational accounts

Azure OAuth uses Microsoft's `/organizations` authority for both endpoints:

- Authorization: `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize`
- Token exchange and refresh: `https://login.microsoftonline.com/organizations/oauth2/v2.0/token`

This supports Microsoft Entra **work or school accounts** across organizational
directories, not personal Microsoft accounts. Keep the app registration's
**Supported account types** set to **Accounts in any organizational directory**
(multitenant). `organizations` is Microsoft's account-type selector, not an
OpenComp organization ID or a hardcoded Azure tenant ID.

If Microsoft reports `unauthorized_client` with "not enabled for consumers",
restart the connection using a work or school account and verify that the
configured client ID is the registration's **Application (client) ID**. Do not
enable personal accounts solely to work around this error. See
[Microsoft's authority and account-type documentation](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-application-configuration).

For a connection that needs an explicit Azure directory, configure an
organization-owned app override with
`customSettings: { "tenantId": "<directory-uuid>" }` through
`POST /v1/integrations/oauth-apps`. Use the directory UUID from **Microsoft Entra
ID → Overview**. Authorization and token exchange use that directory, and the
connection retains its directory for refresh. The shared app ignores a stored
home-directory tenant ID and uses `/organizations`.
After changing the OAuth endpoints, rebuild and deploy the OpenComp API, then
start a fresh Azure connection flow. The endpoint switch alone does not require
new client credentials or a different callback URL.

#### 3. Store and verify credentials

Provision one `IntegrationPlatformCredential` row per shared provider using
operator/IAM tooling. Encrypt the client ID and client secret with the API's
`CredentialVaultService` and store provider settings in `customSettings`.
Keep `ENCRYPTION_KEY` persistent across deployments. The former global admin
credentials endpoint has been removed.

Credentials are read from the database. Adding a secret to `.env` alone does not
configure a shared integration; it must be provisioned into the encrypted store.
Missing, inactive, unreadable, or incomplete shared credentials are unavailable.
Rippling requires `appName`; Vercel requires `appSlug`; GitHub App requires
`githubAppSlug`.

An explicit organization-owned configuration takes precedence within that
organization. Disabled or unreadable overrides do not fall back to the shared app,
since existing tokens belong to the override's client identity. Organization
credentials can be saved through `POST /v1/integrations/oauth-apps` with
`integration:create` permission. Providers outside the shared allowlist continue
to use organization-owned credentials.

Verify availability using an organization-scoped API key with `integration:read`
permission:

```sh
curl "$BASE_URL/v1/integrations/oauth/availability?providerSlug=github-app" \
  -H "x-api-key: $API_KEY"
# Without an org override: available=true, hasPlatformCredentials=true,
# hasOrgCredentials=false
```

Shared lookup does not copy app credentials into organization rows or register
provider apps automatically. See the [shared OAuth runbook](docs/shared-cloud-oauth.md)
for provider requirements and provisioning behavior.

---

### Languages (i18n)

The app ships with English and Spanish locales. The locale is resolved from
the `NEXT_LOCALE` cookie; clear that cookie to fall back to English. All UI
strings live in `apps/app/messages/en.json` and `apps/app/messages/es.json`
— keep both files in sync when adding keys.

---

### Testing

```sh
# App unit tests (Vitest)
cd apps/app && pnpm exec vitest run

# API unit tests (Jest) — loads apps/api/.env automatically
cd apps/api && pnpm exec jest --forceExit

# API e2e tests — needs a local Postgres + migrations applied
cd apps/api && pnpm run test:e2e

# App e2e tests (Playwright) — boots the full stack; see .github/workflows/e2e.yml
cd apps/app && pnpm exec playwright test --project=chromium
```

---

### Database Setup

Start and initialize the PostgreSQL database using Docker:

1. Start the database:

   ```sh
   cd packages/db
   pnpm run docker:up
   ```

2. Default credentials:
   - Database name: `comp`
   - Username: `postgres`
   - Password: `postgres`

3. To change the default password:

   ```sql
   ALTER USER postgres WITH PASSWORD 'new_password';
   ```

4. If you encounter the following error:

   ```
   HINT: No function matches the given name and argument types...
   ```

   Run the fix:

   ```sh
   psql "postgresql://postgres:<your_password>@localhost:5432/comp" -f ./packages/db/prisma/functionDefinition.sql
   ```

   Expected output: `CREATE FUNCTION`

   > 💡 `comp` is the database name. Make sure to use the correct **port** and **database name** for your setup.

5. Apply schema and seed:

```sh
 # Generate Prisma client
 pnpm run db:generate

 # Push the schema to the database
 pnpm run db:push

  # Optional: Seed the database with initial data
  pnpm run db:seed
```

Other useful database commands:

```sh
# Open Prisma Studio to view/edit data
pnpm run db:studio

# Run database migrations
pnpm run db:migrate

# Stop the database container
pnpm run docker:down

# Remove the database container and volume
pnpm run docker:clean
```

---

### Start Development

Once everything is configured:

```sh
pnpm run dev
```

Or use the Turbo repo script (turbo is a root devDependency, no global install needed):

```sh
pnpm exec turbo dev
```

🎉 Yay! You now have a working local instance of Gideon Defender OpenComp! 🚀

### Full Stack with Docker Compose

The monorepo ships a Docker-based local stack that runs everything with `node:22` + pnpm. It builds and starts the API, app, and portal along with Postgres, Redis, and LocalStack (AWS S3). Podman works too (`alias docker=podman`, or `podman-compose`):

```sh
# Build and start the whole stack (app on :3000, portal on :3002, api on :3333)
docker-compose up -d --build

# Run database migrations and seed data
docker-compose run --rm migrator
docker-compose run --rm seeder

# Tail logs for a service (e.g. the app)
docker-compose logs -f app

# Stop everything
docker-compose down
```

Services: `localstack` (S3/SES emulation), `postgres` (pgvector), `migrator` (Prisma migrate), `seeder`, `api` (NestJS), `redis`, `app` (Next.js frontend), `portal` (employee portal), `email-worker` (SQS email consumer), `embeddings` (self-hosted BAAI/bge-m3 via Ollama).

> 💡 **Note:** each service's container env overrides the matching `.env` file
> entries for in-container hostnames (e.g. the portal gets
> `DATABASE_URL=…@postgres:5432` while host-side tooling uses `localhost:5432`).

## Deployment

### Docker

Steps to deploy OpenComp on Docker are coming soon.

### AWS

Gideon hosted production and dev environments run on AWS

Dev deployment is manual; merging to `main` does not deploy automatically. After
merging changes, a repository administrator must run the
[Deploy to Dev workflow](.github/workflows/deploy-dev.yml) from the repository's
**Actions** tab, selecting the current `main` commit. The workflow uses the `dev`
environment secrets `AWS_ACCOUNT_ID`, `AWS_REGION`, `ECS_CLUSTER`,
`AWS_ROLE_TO_ASSUME`, `MIGRATOR_SUBNETS` and `MIGRATOR_SECURITY_GROUP`.

The workflow checks infrastructure and deployment permissions, then builds and
pushes the ARM64 API, app, trust-center, hosted MCP, and migrator images in parallel. All
required image builds must succeed before deployment starts. The email worker
uses the API image; the employee portal is not deployed by this workflow.

The custom-role update includes two independent changes: tenant-scoped role
definition editing and a new default dev deployment mode. Role assignments stay
Gideon-owned. The deployment change replaces mandatory service drains with
rolling deployments; incompatible migrations still require an explicit offline
run. Review both the access-control behavior and deployment behavior for this
release.

By default the workflow runs a **rolling deploy**: it applies compatible pending
migrations before it rolls out images. It preserves running services, desired
replica counts, and autoscaling. No attestation is required. The online migrator
does not add contract or rename approvals. If a known maintenance migration is
pending, it stops before any migration or service rollout and reports that the
run needs `offline_migrations`. Failed migration records require inspection.

When a migration cannot run while old code is live, temporarily enable
**draining migrations** by checking `offline_migrations` in the workflow's
Run dialog. This builds the migrator image and enables the maintenance sequence:

1. Save desired replica counts and autoscaling settings, suspend autoscaling,
   and stop all five services. Verify that every old task has stopped.
2. Apply pending migrations with the staged driver's `offline` phase. The
   migrator preserves the RDS certificate bootstrap and sets the tenant-contract
   and OIDC-rename approvals only on its migration connection.
3. Start the new images with the saved replica counts, verify rollout completion
   and old-task shutdown, then restore the saved autoscaling settings.

Both modes verify the requested task definitions and the hosted MCP edge.
The column-rename migrations require maintenance mode because old and new code
cannot run against the same schema during a rolling deployment.

If maintenance fails after services stop, they can remain stopped with
autoscaling suspended. Inspect the migration and deployment logs, and use the
`dev-maintenance` artifact to recover the original replica counts and scaling
settings. Other migration failures require inspection; do not start old images
against renamed columns. Large-table index and large-split approval gates still
apply. See the
[database recovery guide](packages/db/README.md#tenant-contract-approval-recovery)
for manual recovery outside this workflow.

The deploy role also needs `ecs:ListTasks`, restricted by `ecs:cluster` to the dev
OpenComp cluster. The infrastructure repository manages this grant in
`everything-as-code/terraform/opencomp/iam.tf` as `deploy_task_inspection`. The
workflow checks the permission before image builds start.

Dev domains (`*.dev.gideondefender.com`): `opencomp.dev` → app, `trust.dev/{friendlyUrl}` → trust-center, `opencomp-api.dev` → API, `mcp.dev` → hosted MCP.

Key env/config for a `dev` deploy:

```env
BASE_URL=https://opencomp-api.dev.gideondefender.com
NEXT_PUBLIC_APP_URL=https://opencomp.dev.gideondefender.com
NEXT_PUBLIC_API_URL=https://opencomp-api.dev.gideondefender.com
NEXT_PUBLIC_BETTER_AUTH_URL=https://opencomp-api.dev.gideondefender.com
NEXT_PUBLIC_TRUST_API_URL=https://opencomp-api.dev.gideondefender.com
TRUST_APP_URL=https://trust.dev.gideondefender.com  # build-time for trust-center
LOCAL_TRIGGER_DATABASE_URL=postgresql://...?options=-c%20search_path%3Dopencomp_trigger%2Cpublic
```

We are not baking secrets into the image!

AWS services used to host OpenComp:

- Bedrock
- ECS Fargate
- ElastiCache
- RDS Postgres with RLS enabled
- S3
- SES
- SQS

Notes: session cookies are isolated per env (`dev` prefix / `.dev.gideondefender.com` domain, mirroring the staging carve-out); `opencomp.dev.gideondefender.com` must be in the billing-redirect allowlist; leave `TRUST_PORTAL_PROJECT_ID` / Vercel vars unset in dev (custom domains stay on the shared-domain path until a separate dev Vercel project exists). Database migrations also provision the `opencomp_trigger` schema. Contract migrations run only after the tenant-aware services have rolled out and old tasks have stopped.

## 📦 Package Publishing

This repository uses semantic-release to automatically publish packages to npm when merging to the `release` branch. The following packages are published:

- `@gideon-defender/db` - Database utilities with Prisma client
- `@gideon-defender/email` - Email templates and components
- `@gideon-defender/kv` - Key-value store utilities using Redis
- `@gideon-defender/ui` - UI component library with Tailwind CSS

### Setup

1. **NPM Token**: Add your npm token as `NPM_TOKEN` in GitHub repository secrets
2. **Release Branch**: Create and merge PRs into the `release` branch to trigger publishing
3. **Versioning**: Uses conventional commits for automatic version bumping

### Usage

```bash
# Install a published package
pnpm add @gideon-defender/ui

# Use in your project
import { Button } from '@gideon-defender/ui/button'
import { client } from '@gideon-defender/kv'
```

### Development

```bash
# Build all packages
pnpm run build

# Build specific package
pnpm --filter=@gideon-defender/ui run build

# Test packages locally
pnpm run release:packages -- --dry-run
```

## License

OpenComp is an open-source software, licensed under [AGPLv3](https://opensource.org/license/agpl-v3)

> [!TIP]
> We work closely with the community and always invite feedback about what should be open and what is fine to be commercial. This list is not set and stone and we have moved things from commercial to open in the past. Please open a [discussion](https://github.com/gideon-security/opencomp/discussions) if you feel like something is wrong.
