-- Phase 0 (remove-cross-tenant-roles): credential provenance on IntegrationOAuthApp.
-- Existing rows default to 'customer'. Automation backfill/provisioning sets
-- 'automation' with an automationVersion; customer writes switch ownership back
-- to 'customer' and clear the version. (Unrelated schema/history drift excluded.)
ALTER TABLE "IntegrationOAuthApp" ADD COLUMN "managementSource" TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE "IntegrationOAuthApp" ADD COLUMN "automationVersion" TEXT;
