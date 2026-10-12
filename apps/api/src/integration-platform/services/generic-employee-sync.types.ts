import type { ResolvedSyncEmployeeFilter } from './sync-employee-filter';

export interface SyncResultDetail {
  email: string;
  status: 'imported' | 'skipped' | 'deactivated' | 'reactivated' | 'error';
  reason?: string;
}

export interface SyncResult {
  success: boolean;
  totalFound: number;
  imported: number;
  skipped: number;
  deactivated: number;
  reactivated: number;
  errors: number;
  details: SyncResultDetail[];
}

export interface ProcessEmployeesOptions {
  /** Default role for new members. Defaults to 'employee'. */
  defaultRole?: string;
  /** Whether to reactivate previously deactivated members. Defaults to false. */
  allowReactivation?: boolean;
  /** Roles that should never be auto-deactivated. Defaults to owner/admin/auditor. */
  protectedRoles?: string[];
  /** Provider slug for deactivation reason messages. */
  providerName?: string;
  /**
   * Whether the provider is authoritative for "who works here" (directory of record).
   *
   * When false (default), Phase 2 is skipped entirely: members absent from the sync
   * payload are left alone. Set true only for HRIS / identity providers whose user
   * list = the employee list (Google Workspace, Rippling, JumpCloud, Okta, Entra).
   *
   * This prevents feature-licensed tools (Confluence, Slack, etc.) from silently
   * deactivating active employees when their API returns a partial member list.
   */
  isDirectorySource?: boolean;
  /**
   * Optional include/exclude email filter (resolved from connection variables).
   *
   * When omitted (or mode 'all'), every active employee is imported — the
   * historical behavior. When provided, this mirrors the Google Workspace /
   * JumpCloud sync filter so dynamic providers (e.g. Microsoft Entra) can
   * limit which users are synced.
   */
  syncFilter?: ResolvedSyncEmployeeFilter;
}
