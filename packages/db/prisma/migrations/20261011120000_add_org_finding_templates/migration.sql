-- Org-scoped finding templates. Null organizationId = global template
-- visible to every org (seeded/legacy rows stay global). Set = per-org
-- template managed by that org's admins via the finding-template API.
ALTER TABLE "FindingTemplate" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "FindingTemplate" ADD CONSTRAINT "FindingTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "FindingTemplate_organizationId_idx" ON "FindingTemplate"("organizationId");
