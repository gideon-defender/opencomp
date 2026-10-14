BEGIN;

-- CreateTable
CREATE TABLE "people_candidates" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('pcd'::text),
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkr_intake_connections" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('ckc'::text),
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apiKeySecretId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "node" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkr_intake_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_screenings" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('pcs'::text),
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT,
    "package" TEXT NOT NULL,
    "node" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "candidateKey" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "invitationKey" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "checkrCandidateId" TEXT,
    "checkrInvitationId" TEXT,
    "chargedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "firstDispatchAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "people_candidates_organizationId_email_key" ON "people_candidates"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "people_candidates_id_organizationId_key" ON "people_candidates"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "checkr_intake_connections_organizationId_key" ON "checkr_intake_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "checkr_intake_connections_accountId_key" ON "checkr_intake_connections"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "checkr_intake_connections_id_organizationId_key" ON "checkr_intake_connections"("id", "organizationId");

-- CreateIndex
CREATE INDEX "candidate_screenings_organizationId_createdAt_idx" ON "candidate_screenings"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "candidate_screenings_status_nextAttemptAt_idx" ON "candidate_screenings"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_screenings_organizationId_operationId_key" ON "candidate_screenings"("organizationId", "operationId");

-- AddForeignKey
ALTER TABLE "people_candidates" ADD CONSTRAINT "people_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkr_intake_connections" ADD CONSTRAINT "checkr_intake_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_screenings" ADD CONSTRAINT "candidate_screenings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_screenings" ADD CONSTRAINT "candidate_screenings_candidateId_organizationId_fkey" FOREIGN KEY ("candidateId", "organizationId") REFERENCES "people_candidates"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_screenings" ADD CONSTRAINT "candidate_screenings_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "checkr_intake_connections"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reject malformed ownership and lifecycle data even for non-API writers.
ALTER TABLE "people_candidates" ADD CONSTRAINT "people_candidates_normalized_email"
  CHECK (email = lower(btrim(email)) AND email <> '');
ALTER TABLE "candidate_screenings" ADD CONSTRAINT "candidate_screenings_normalized_email"
  CHECK (email = lower(btrim(email)) AND email <> '');
ALTER TABLE "candidate_screenings" ADD CONSTRAINT "candidate_screenings_status"
  CHECK (status IN ('queued', 'dispatching', 'invited', 'refunding', 'failed', 'needs_review'));
ALTER TABLE "checkr_intake_connections" ADD CONSTRAINT "checkr_intake_environment"
  CHECK (environment IN ('sandbox', 'production'));

-- A configured secret must belong to the very same organization.
CREATE UNIQUE INDEX "secrets_id_organization_id_key" ON "secrets" (id, organization_id);
ALTER TABLE "checkr_intake_connections" ADD CONSTRAINT "checkr_intake_secret_tenant_fk"
  FOREIGN KEY ("apiKeySecretId", "organizationId") REFERENCES "secrets" (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE "people_candidates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "people_candidates"
  USING ("organizationId" = public.app_current_tenant()) WITH CHECK ("organizationId" = public.app_current_tenant());
ALTER TABLE "candidate_screenings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "candidate_screenings"
  USING ("organizationId" = public.app_current_tenant()) WITH CHECK ("organizationId" = public.app_current_tenant());
ALTER TABLE "checkr_intake_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "checkr_intake_connections"
  USING ("organizationId" = public.app_current_tenant()) WITH CHECK ("organizationId" = public.app_current_tenant());

COMMIT;
