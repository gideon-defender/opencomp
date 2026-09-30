# =============================================================================
# Multi-stage build: migrator/seeder, app, portal, trust-center.
# Uses pnpm workspaces + node:22. Built for linux/arm64.
# =============================================================================

# =============================================================================
# STAGE 1: Dependencies - Install and cache workspace dependencies
# =============================================================================
FROM node:22-slim AS deps

WORKDIR /app

# pnpm binary for all downstream stages inheriting from deps. Fetch flags
# tolerate flaky registry access (dropped TLS mid-download).
RUN npm install -g pnpm@10.15.0 --fetch-retries=8 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# Copy workspace configuration. Workspace deps use `*` ranges, which pnpm
# links to the local workspaces natively — no spec conversion needed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY apps/app/package.json ./apps/app/package.json
COPY apps/portal/package.json ./apps/portal/package.json
COPY apps/trust-center/package.json ./apps/trust-center/package.json

# Install all dependencies (lifecycle scripts skipped; prisma + workspace
# package builds are run explicitly in later stages).
RUN pnpm install --ignore-scripts

# pnpm links only declared deps per package, but the apps import workspace
# members they don't declare (ui, analytics, kv, ...), so link every
# workspace member into node_modules to preserve resolution.
RUN node -e "const fs=require('fs'),path=require('path');const nm='/app/node_modules';for(const top of ['packages','apps']){const dir='/app/'+top;if(!fs.existsSync(dir))continue;for(const entry of fs.readdirSync(dir)){const p=path.join(dir,entry);const mf=path.join(p,'package.json');if(!fs.statSync(p).isDirectory()||!fs.existsSync(mf))continue;let name;try{name=JSON.parse(fs.readFileSync(mf,'utf8')).name;}catch{}if(!name)continue;const link=path.join(nm,...name.split('/'));if(fs.existsSync(link)||fs.lstatSync(link,{throwIfNoEntry:false}))continue;fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(path.relative(path.dirname(link),p),link);}}"

# =============================================================================
# STAGE 2: Ultra-Minimal Migrator / Seeder - Only Prisma
# =============================================================================
FROM node:22-slim AS migrator

WORKDIR /app

# pnpm for the one-off tool install below. .npmrc carries fetch retries.
RUN npm install -g pnpm@10.15.0 --fetch-retries=8 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY .npmrc ./

# Local Prisma schema, migrations, and the seed script.
COPY packages/db ./packages/db

# Install ONLY Prisma + seed runtime dependencies.
RUN npm init -y >/dev/null && pnpm add prisma@7.6.0 @prisma/client@7.6.0 @prisma/adapter-pg@7.6.0 zod@^4 tsx@^4

# Combine the split schema files into dist/schema.prisma and generate the
# @prisma/client runtime (prisma-client-js) into node_modules/@prisma/client.
RUN cd packages/db \
  && node scripts/combine-schemas.js \
  && node scripts/generate-prisma-client-js.js \
  && cp -R prisma/migrations dist/migrations

# Prisma 7 requires the datasource URL in prisma.config.ts (not in schema.prisma).
RUN printf 'import "dotenv/config";\nimport { defineConfig } from "prisma/config";\n\nexport default defineConfig({\n  schema: "packages/db/dist/schema.prisma",\n  migrations: { path: "packages/db/dist/migrations" },\n  datasource: { url: process.env.DATABASE_URL! },\n});\n' > prisma.config.ts

# Run migrations against the combined schema (direct bin path — no package
# manager needed at runtime).
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

# =============================================================================
# STAGE 3: App Builder
# =============================================================================
FROM deps AS app-builder

WORKDIR /app

# Copy all source code needed for build
COPY apps/app ./apps/app

# Build workspace packages the app resolves through their package `exports`
# (dist entry points). Build all internal packages the app imports (incl.
# analytics, kv, ui which it uses without declaring as deps).
RUN cd packages/db && pnpm run build \
  && cd ../auth && pnpm run build \
  && cd ../company && pnpm run build \
  && cd ../billing && pnpm run build \
  && cd ../integration-platform && pnpm run build \
  && cd ../email && pnpm run build \
  && cd ../analytics && pnpm run build \
  && cd ../utils && pnpm run build \
  && cd ../kv && pnpm run build \
  && cd ../ui && pnpm run build

# Ensure Next build has required public env at build-time
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ARG NEXT_PUBLIC_PORTAL_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_IS_DUB_ENABLED
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_PUBLIC_PORTAL_URL=$NEXT_PUBLIC_PORTAL_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_IS_DUB_ENABLED=$NEXT_PUBLIC_IS_DUB_ENABLED \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=4096

# Build the app. Copy the split Prisma model files into apps/app/prisma/schema
# (the committed schema.prisma is only the generator/datasource stub), matching
# the local `db:getschema` + `db:generate` flow.
RUN cd apps/app \
  && find ../../packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' -exec cp {} prisma/schema/ \; \
  && SKIP_ENV_VALIDATION=true pnpm run build:docker

# =============================================================================
# STAGE 4: App Production
# =============================================================================
FROM node:22-slim AS app

WORKDIR /app

# Copy Next standalone output
COPY --from=app-builder /app/apps/app/.next/standalone ./
COPY --from=app-builder /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=app-builder /app/apps/app/public ./apps/app/public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "apps/app/server.js"]

# =============================================================================
# STAGE 5: Portal Builder
# =============================================================================
FROM deps AS portal-builder

WORKDIR /app

# Copy all source code needed for build
COPY apps/portal ./apps/portal

# Build workspace packages the portal resolves through their package `exports`.
RUN cd packages/db && pnpm run build \
  && cd ../auth && pnpm run build \
  && cd ../company && pnpm run build \
  && cd ../email && pnpm run build \
  && cd ../analytics && pnpm run build \
  && cd ../utils && pnpm run build \
  && cd ../kv && pnpm run build \
  && cd ../ui && pnpm run build

# Ensure Next build has required public env at build-time
ARG NEXT_PUBLIC_BETTER_AUTH_URL
ENV NEXT_PUBLIC_BETTER_AUTH_URL=$NEXT_PUBLIC_BETTER_AUTH_URL \
    NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=4096 \
    APP_AWS_REGION=us-east-1 APP_AWS_ACCESS_KEY_ID=local \
    APP_AWS_SECRET_ACCESS_KEY=local

# Build the portal. Copy the split Prisma model files into apps/portal/prisma/schema,
# matching the local `db:getschema` + `db:generate` flow.
RUN cd apps/portal \
  && find ../../packages/db/prisma/schema -name '*.prisma' ! -name 'schema.prisma' -exec cp {} prisma/schema/ \; \
  && SKIP_ENV_VALIDATION=true pnpm run build:docker

# =============================================================================
# STAGE 6: Portal Production
# =============================================================================
FROM node:22-slim AS portal

WORKDIR /app

# Copy Next standalone output for portal
COPY --from=portal-builder /app/apps/portal/.next/standalone ./
COPY --from=portal-builder /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=portal-builder /app/apps/portal/public ./apps/portal/public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "apps/portal/server.js"]

# (Tasks run in-process via the local-trigger shim; no external runner.)

# =============================================================================
# STAGE 7: Trust-Center Builder (public trust portal, no auth/Prisma)
# =============================================================================
FROM deps AS trust-center-builder

WORKDIR /app

# Copy all source code needed for build
COPY apps/trust-center ./apps/trust-center

# @gideon-defender/utils resolves through its package `exports` (dist entry
# points), so build it before the Next build.
RUN cd packages/utils && pnpm run build

# NEXT_PUBLIC_* values inline at build time — runtime env cannot change them.
# Pass NEXT_PUBLIC_TRUST_API_URL as a build arg when building for non-local hosts.
ARG NEXT_PUBLIC_TRUST_API_URL=http://localhost:3333
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ENV NEXT_PUBLIC_TRUST_API_URL=$NEXT_PUBLIC_TRUST_API_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN cd apps/trust-center \
  && NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    NODE_OPTIONS=--max_old_space_size=4096 \
    pnpm run build

# =============================================================================
# STAGE 8: Trust-Center Production
# =============================================================================
FROM node:22-slim AS trust-center

WORKDIR /app

# Copy Next standalone output for trust-center
COPY --from=trust-center-builder /app/apps/trust-center/.next/standalone ./
COPY --from=trust-center-builder /app/apps/trust-center/.next/static ./apps/trust-center/.next/static
COPY --from=trust-center-builder /app/apps/trust-center/public ./apps/trust-center/public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "apps/trust-center/server.js"]
