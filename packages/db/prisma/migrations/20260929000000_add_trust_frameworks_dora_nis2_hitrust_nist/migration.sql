-- Add DORA, NIS 2, HITRUST CSF, NIST CSF, and NIST 800-53 as native Trust
-- Portal frameworks (Trust toggle/status columns + TrustFramework enum values),
-- mirroring the soc3 and pipeda+ccpa migrations.
--
-- Safe to combine these in a single migration because the new *_status columns
-- use the pre-existing `FrameworkStatus` enum — the newly-added
-- `TrustFramework` values are not referenced in any statement in this file.
ALTER TYPE "TrustFramework" ADD VALUE IF NOT EXISTS 'dora';
ALTER TYPE "TrustFramework" ADD VALUE IF NOT EXISTS 'nis_2';
ALTER TYPE "TrustFramework" ADD VALUE IF NOT EXISTS 'hitrust_csf';
ALTER TYPE "TrustFramework" ADD VALUE IF NOT EXISTS 'nist_csf';
ALTER TYPE "TrustFramework" ADD VALUE IF NOT EXISTS 'nist_800_53';

ALTER TABLE "Trust"
  ADD COLUMN "dora" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dora_status" "FrameworkStatus" NOT NULL DEFAULT 'started',
  ADD COLUMN "nis_2" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nis_2_status" "FrameworkStatus" NOT NULL DEFAULT 'started',
  ADD COLUMN "hitrust_csf" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hitrust_csf_status" "FrameworkStatus" NOT NULL DEFAULT 'started',
  ADD COLUMN "nist_csf" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nist_csf_status" "FrameworkStatus" NOT NULL DEFAULT 'started',
  ADD COLUMN "nist_800_53" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nist_800_53_status" "FrameworkStatus" NOT NULL DEFAULT 'started';
