-- Phase 0 (IdP-owned user management): audit-mode columns on Member.
--
-- What changes and why:
--   * Member.roleSource ('local' | 'sso', default 'local'): marks IdP-managed
--     memberships so guards/UI can distinguish them. Default preserves current
--     behavior; Phase 1 conversion overwrites to 'sso'.
--   * Member.idpAccessRevoked (boolean, default false): set by IdP
--     reconciliation when assignments vanish. Independent of HR/local
--     `deactivated`; IdP reconciliation never clears that existing flag.
--
-- No backfill: every existing row keeps roleSource='local',
-- idpAccessRevoked=false. No RLS change (table policy already covers new
-- columns). Audit mode only — no behavior change at login.

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "roleSource" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "Member" ADD COLUMN "idpAccessRevoked" BOOLEAN NOT NULL DEFAULT false;
