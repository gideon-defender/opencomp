# Owned hosted MCP

The first owned hosted deployment uses organization API keys. It runs alongside
the retained Gram OAuth connection. The dev endpoint, once infrastructure and
the first image are deployed, is `https://mcp.dev.gideondefender.com/mcp`.

## Runtime and clients

Clients use Streamable HTTP and send their organization key in the `apikey`
header on every request. Configure an HTTP MCP connection with that URL and
header in your client's credential settings. Do not put keys in URLs.
This endpoint does not advertise OAuth or accept OAuth bearer credentials.
Clients that require OAuth should continue using Gram during this migration.

The container starts with:

```sh
node dist-owned/bin/mcp-server.js serve --hosted --mode dynamic \
  --server-url https://opencomp-api.dev.gideondefender.com \
  --public-url https://mcp.dev.gideondefender.com
```

Hosted mode requires explicit HTTPS origins, ignores `COMPAI_APIKEY`, and rejects
static credential flags. The runtime validates each request's key through the
API's `/v1/auth/me` before MCP discovery or execution. Revoked/expired keys fail
on the next request; auth service failures return 503. Tool calls still go through
the API's existing organization binding, RBAC and audit enforcement. Requests
cannot choose an upstream API URL. The public Host and any Origin header must
match the configured MCP origin. The deployment uses stateless HTTP so multiple
tasks need no shared session storage or sticky routing.

`/healthz` is an unauthenticated process readiness check for ECS and the ALB.
It does not make API calls or guarantee that customer credentials work.

## Infrastructure bootstrap and deployment

Infrastructure is owned by `everything-as-code/terraform/opencomp`, alongside
the existing dev API and frontend services. Apply its MCP foundation before
merging the OpenComp workflow change. `enable_mcp = true` provisions:

- An immutable ECR repository and a zero-task ECS Fargate service until an image exists.
- A dedicated HTTPS hostname, ACM certificate, ALB target and Route 53 records.
- Dedicated task and execution roles, ALB-only ingress and HTTPS egress.
- Encrypted logs, a memory alarm and scoped permissions for the existing deployment role.

MCP receives no API key, database/Redis connection or application secrets.
The shared ALB timeout is 180 seconds; MCP requests have a 120-second deadline.
The MCP target drains for 150 seconds during deployments.

After bootstrap, successful push CI on `main` triggers `deploy-dev.yml`.
Pull-request CI cannot deploy. Manual deployment remains restricted to repository
administrators on `main`. All images use the exact CI commit, and deployment
rejects a commit superseded while building. The existing `dev` GitHub environment
and its AWS OIDC credentials remain in use; no new GitHub secret is required.
Environment reviewer policies still apply.

The workflow checks MCP infrastructure before builds/migrations, builds the
owned bundle into an ARM64 image, tests health and unauthenticated rejection in
a read-only container, then pushes it. After database migrations succeed, it
registers task definitions, updates services and activates one MCP task. It waits
for service stability, verifies each requested task definition actually deployed,
then checks public HTTPS health and unauthenticated rejection.

Record the deployed image tags in infrastructure's `dev.tfvars` before subsequent
Terraform applies. In particular, missing `image_tags.mcp` represents bootstrap
and would set the MCP service back to zero tasks. Infrastructure changes and
application deployment are separate operations; the main workflow does not apply
Terraform. No npm publication is needed to deploy the container.

## Acceptance and rollback

After deployment, use an explicitly approved test organization key to connect,
discover tools, execute a safe read and verify expected RBAC denial. Test two
organizations independently and revoke a test key to verify immediate rejection.
The automated suite uses fake keys and mock APIs; it does not replace live acceptance.
Move API-key clients to the new URL after this check. Retain Gram, its OAuth
configuration and the generated compatibility oracle through the observation
window; OAuth migration remains separate work.

ECS deployment circuit breakers retain the previous task definition when a new
image cannot become healthy. The workflow reports a rollback as failure. For a
manual rollback, update `gideon-dev-opencomp-mcp` to the previous known-good task
definition and wait for stability, then record the matching immutable image tag
in infrastructure. Scale MCP to zero if isolation is needed; Gram stays available.
Disable automatic deployment while investigating a faulty main commit.
