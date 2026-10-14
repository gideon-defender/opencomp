# @gideon-defender/db

Database package for OpenComp.

## What’s included

- Prisma schema: `dist/schema.prisma`
- Built output: `dist/`
- Postinstall helper binary: `comp-prisma-postinstall`

## Install

```bash
npm install @gideon-defender/db
```

## Usage

```ts
import { db } from '@gideon-defender/db';
```

## Notes

- Publishing runs a build automatically via `prepublishOnly`.
- See `INTEGRATION_GUIDE.md` for integration details.

## Tenant migration regression tests

Run from `packages/db` with a local test PostgreSQL database and `psql` on PATH:

```bash
USER_TENANT_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres \
  pnpm exec vitest run src/user-tenant-migrations.spec.ts
```

The suite creates and removes isolated schemas. It checks mixed ownership
signals beyond 5,000 rows, DDL lock release, batch commits, retry behavior,
contract rollback, and the pinned Prisma migration runner. Without the database
URL, these integration tests are skipped. Set `PSQL_BIN` if `psql` needs an
explicit path.

## Embedding providers

The shared `embedTexts` client is used by risk/vendor task matching and API
vector search. Local Ollama remains the default (`EMBEDDING_MODEL=bge-m3`,
`EMBEDDINGS_BASE_URL=http://localhost:11434`); `tei` retains the compatible
HTTP endpoint and bare-array response support.

For AWS-hosted deployments set `EMBEDDINGS_PROVIDER=bedrock`,
`EMBEDDING_MODEL=amazon.titan-embed-text-v2:0` and `AWS_REGION` (or
`APP_AWS_REGION`). Bedrock uses SDK `InvokeModel` with the default AWS
credential chain, including ECS task-role credentials; `EMBEDDINGS_BASE_URL`
is ignored for this provider. Vectors must contain 1024 finite numbers to
match the database column. Requests preserve input order, run at most four
concurrently and have a 30-second deadline per invocation.

Before deploying, verify the task role permits `bedrock:InvokeModel` on the
configured model and that the region has nonzero Titan V2 request and token
quotas. Zero quotas cause `ThrottlingException` even for one request. If AWS
marks those quotas non-adjustable, contact AWS support to enable capacity;
retries cannot repair zero capacity. Validate with a generic test sentence
before retrying a failed risk scan. Deploy the shared package with both app
and API images. Embedding hashes include the model identity, so model changes
cause linkage to recompute its affected vectors.

### Changing the embedding model

Apply the `embedding_model_identity` database migration before deploying the app
and API images. Each new vector records its provider, model, and dimensions in
`embeddingModel`; legacy vectors retain NULL because their model is unknown.
Similarity queries exclude vectors with a different or unknown identity.

Both document retrieval entry points await incremental organization sync. Sync
rebuilds policy, context, manual-answer, and knowledge-base vectors when their
model identity differs, even if source timestamps are unchanged. Any failed
source rebuild blocks retrieval; the next request retries missing or outdated
vectors. The first request after a model change can take longer to rebuild the
index. Subsequent syncs skip unchanged current-model documents. Linkage hashes
also include provider identity, so existing task vectors rebuild on the next scan.

## Tenant contract approval recovery

An ordinary `pnpm exec prisma migrate deploy` stops at the contract approval
gate on populated databases. Prisma records that migration as failed. After
the tenant-aware code has rolled out and old nodes have drained, run from
`packages/db` with the same database URL:

```sh
pnpm exec prisma migrate resolve --rolled-back 20261013000004_user_tenant_enforce
```

This clears the failed migration record; it does not roll back SQL. Add
`options=-c app.tenant_contract_approved=yes` to the connection URL (URL-encoded),
then run `pnpm exec prisma migrate deploy`. If validation or session cleanup
fails at its approval gate, resolve that specific failed migration before retry.
For other failures, verify rollback or repair partial changes before resolving.
