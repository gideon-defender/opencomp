// ============================================================================
// Integration Platform - Main Exports
// ============================================================================

// Types
export type {
  // Auth types
  ApiKeyConfig,
  AuthStrategy,
  AuthStrategyType,
  BasicAuthConfig,
  // Check types
  CheckContext,
  CheckEvidence,
  CheckFindingResult,
  CheckPassingResult,
  CheckVariable,
  CheckVariableType,
  CheckVariableValues,
  // Connection & Run types
  ConnectionStatus,
  // Credential types
  CredentialField,
  CustomAuthConfig,
  // Finding types
  FindingSeverity,
  FindingStatus,
  // Capability types
  IntegrationCapability,
  // Category type
  IntegrationCategory,
  IntegrationCheck,
  // Handler types
  IntegrationCredentials,
  IntegrationFinding,
  IntegrationHandler,
  // Manifest type
  IntegrationManifest,
  // Registry type
  IntegrationRegistry,
  // Service types
  IntegrationService,
  JwtConfig,
  OAuthConfig,
  RunJobType,
  RunStatus,
  VariableFetchContext,
  // Webhook types
  WebhookConfig,
} from './types';

// Zod schemas for validation
export {
  ApiKeyConfigSchema,
  BasicAuthConfigSchema,
  CredentialFieldSchema,
  CustomAuthConfigSchema,
  JwtConfigSchema,
  OAuthConfigSchema,
  WebhookConfigSchema,
} from './types';

// Registry
export {
  getActiveManifests,
  getAllManifests,
  getByCategory,
  getCategoriesWithCounts,
  getHandler,
  getIntegrationIds,
  getManifest,
  getOAuthConfig,
  isCodeManifest,
  registry,
  requiresOAuth,
} from './registry';

// Runtime (check execution)
export {
  createCheckContext,
  getAvailableChecks,
  runAllChecks,
  runCheck,
  type CheckContextOptions,
  type CheckResult,
  type CheckRunResult,
  type RunAllChecksResult,
  type RunCheckOptions,
} from './runtime';

// Task mappings (for type-safe task mapping in checks)
export {
  TASK_TEMPLATES,
  TASK_TEMPLATE_IDS,
  TASK_TEMPLATE_INFO,
  type TaskTemplateId,
} from './task-mappings';

// DSL Engine (declarative check and sync definitions)
export {
  CheckDefinitionSchema,
  CodeStepSchema,
  ConditionSchema,
  DSLStepSchema,
  DynamicIntegrationDefinitionSchema,
  SyncDefinitionSchema,
  SyncDeviceSchema,
  SyncEmployeeSchema,
  evaluateCondition,
  evaluateOperator,
  interpolate,
  interpolateTemplate,
  interpretDeclarativeCheck,
  interpretDeclarativeDeviceSync,
  interpretDeclarativeSync,
  resolvePath,
  validateIntegrationDefinition,
} from './dsl';

export type {
  CheckDefinition,
  CodeStep,
  Condition,
  DSLStep,
  DynamicIntegrationDefinition,
  PaginationConfig,
  SyncDefinition,
  SyncDevice,
  SyncEmployee,
  ValidationResult,
} from './dsl';

// Individual manifests (for direct import if needed)
export { manifest as githubManifest } from './manifests/github';

// Directory sync email include/exclude terms (Google Workspace, JumpCloud, checks)
export { matchesSyncFilterTerms, parseSyncFilterTerms } from './sync-filter/email-exclusion-terms';

// AWS credential helpers (used by frontend setup dialogs)
export {
  getAwsCloudShellScript,
  getAwsCloudShellUrl,
  normalizeAwsEnvironment,
} from './manifests/aws/credentials';
export type { AwsEnvironment } from './manifests/aws/credentials';

// AWS remediation role script (split from credentials to respect the
// 300-line file limit) — same public import path as before.
export { getAwsRemediationScriptForPair } from './manifests/aws/remediation-script';
export type { RemediationScriptPair } from './manifests/aws/remediation-script';

// Asset-class x region remediator roles (Phase 2): shared by the API
// (assume routing, validation) and the frontend (per-pair setup UI).
export {
  APPROVAL_GATED_ASSET_CLASSES,
  AWS_LEGACY_REMEDIATION_ROLE_NAME,
  AWS_REMEDIATION_ROLE_NAME_PREFIX,
  FIX_FORWARD_ALLOWLIST,
  NEVER_ALLOW_REMEDIATION_ACTIONS,
  REMEDIATION_ASSET_CLASSES,
  SAFE_AWS_REGION_PATTERN,
  SAFE_IAM_ROLE_TOKEN_PATTERN,
  SECURITY_GLOBAL_PINNED_REGION,
  buildRemediationPolicyDocument,
  escapeDoubleQuotedShell,
  findingToAssetClass,
  getRemediationRolesParseError,
  isApprovalGatedAssetClass,
  isRemediationRoleKey,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  serializeRemediationRolesMap,
} from './manifests/aws/remediation-roles';
export type { RemediationAssetClass } from './manifests/aws/remediation-roles';

// Customer-side CloudTrail detection for the remediator roles (EventBridge
// patterns, Lake queries, SNS wiring script) — served to customers via
// `pnpm run generate:remediation-detection-script` (see
// docs/runbooks/remediation-detection-script.md) so the alerts and the
// queries cannot drift apart.
export {
  REMEDIATION_DETECTION_RULES,
  REMEDIATION_DETECTION_SUBJECTS,
  REMEDIATION_DETECTION_TOPIC_NAME,
  REMEDIATION_LAKE_QUERIES,
  buildDetectionPattern,
  buildRemediationAssumePattern,
  buildRemediationDeniedPattern,
  buildSecurityGlobalAssumePattern,
  getRemediationDetectionScript,
} from './manifests/aws/remediation-detection';
export type {
  RemediationDetectionPatternOptions,
  RemediationDetectionRule,
  RemediationDetectionScriptOptions,
  RemediationLakeQuery,
} from './manifests/aws/remediation-detection';

// Customer-side Cloud Logging detection for the GCP remediator SAs
// (log-based metric filters, alerting policies, forensics queries, email
// wiring script) — served to customers via
// `pnpm run generate:gcp-remediation-detection-script` so the alerts and
// the queries cannot drift apart. Mirrors the AWS detector above.
export {
  GCP_REMEDIATION_DETECTION_CHANNEL_NAME,
  GCP_REMEDIATION_DETECTION_DESCRIPTIONS,
  GCP_REMEDIATION_DETECTION_METRICS,
  GCP_REMEDIATION_DETECTION_RULES,
  GCP_REMEDIATION_LOG_QUERIES,
  buildGcpAlertingPolicy,
  buildGcpApprovalGatedFilter,
  buildGcpDeniedFilter,
  buildGcpDetectionFilter,
  buildGcpImpersonationFilter,
  getGcpRemediationDetectionScript,
} from './manifests/gcp/remediation-detection';
export type {
  GcpRemediationDetectionRule,
  GcpRemediationDetectionScriptOptions,
  GcpRemediationLogQuery,
} from './manifests/gcp/remediation-detection';

// GCP remediator roles + allowlist + setup script (Phase 1): shared by the
// API (identity routing, validation) and the frontend (per-pair setup UI).
export {
  decodeGcpPathnameToFixedPoint,
  gcpRollbackDeletePrefixAllowed,
  isGcpAllowlistedFixStep,
  splitGcpPathSegments,
} from './manifests/gcp/remediation-allowlist';
export type { GcpAllowlistedCall } from './manifests/gcp/remediation-allowlist';
export {
  APPROVAL_GATED_GCP_ASSET_CLASSES,
  GCP_FIX_FORWARD_ALLOWLIST,
  GCP_NEVER_ALLOW_PERMISSIONS,
  GCP_NEVER_ALLOW_ROLES,
  GCP_REMEDIATION_ASSET_CLASSES,
  GCP_REMEDIATOR_SA_EMAIL_PATTERN,
  GCP_REMEDIATOR_SA_NAME,
  MAX_GCP_REMEDIATION_PAIRS,
  SAFE_GCP_PROJECT_PATTERN,
  gcpFindingToAssetClass,
  gcpRemediationKey,
  gcpRemediationRoleId,
  gcpRemediationSaEmail,
  getGcpRemediationMapParseError,
  isApprovalGatedGcpAssetClass,
  isGcpRemediationKey,
  normalizeGcpRemediationKey,
  parseGcpRemediationMap,
  serializeGcpRemediationMap,
} from './manifests/gcp/remediation-roles';
export type { GcpRemediationAssetClass } from './manifests/gcp/remediation-roles';
export { getGcpRemediationScriptForPair } from './manifests/gcp/remediation-script';
export type { GcpRemediationScriptPair } from './manifests/gcp/remediation-script';

// Azure remediator roles + allowlist + setup script (Phase A): shared by
// the API (identity routing, validation, trust probe) and the frontend
// (per-pair setup UI).
export {
  AZURE_FIX_FORWARD_ACTIONS,
  AZURE_FIX_FORWARD_ALLOWLIST,
  AZURE_NEVER_ALLOW_ACTIONS,
  AZURE_NEVER_ALLOW_ROLES,
  azureRollbackDeletePrefixAllowed,
  buildAzureCustomRoleDefinition,
  isAzureAllowlistedFixStep,
  normalizeAzureUrlForAllowlist,
} from './manifests/azure/remediation-allowlist';
export type {
  AzureAllowlistedCall,
  AzureCustomRoleDefinition,
} from './manifests/azure/remediation-allowlist';
export {
  AZURE_APPROVAL_GATED_SURFACES,
  AZURE_REMEDIATION_DETECTION_DESCRIPTIONS,
  AZURE_REMEDIATION_DETECTION_RULES,
  buildAzureApprovalGatedConditions,
  buildAzureDetectionConditions,
  buildAzureForensicQueries,
  buildAzureRemediatorDeniedConditions,
  buildAzureRemediatorWriteConditions,
  renderAzureAlertCondition,
} from './manifests/azure/remediation-detection-filters';
export type {
  AzureAlertCondition,
  AzureApprovalGatedSurfaceCode,
  AzureForensicQuery,
  AzureRemediationDetectionRule,
} from './manifests/azure/remediation-detection-filters';
export {
  AZURE_REMEDIATION_DETECTION_ACTION_GROUP_NAME,
  azureActionGroupId,
  azureDetectionRuleName,
  getAzureRemediationDetectionScript,
} from './manifests/azure/remediation-detection-script';
export type {
  AzureRemediationDetectionScriptOptions,
  AzureRemediationDetectionService,
} from './manifests/azure/remediation-detection-script';
export {
  APPROVAL_GATED_AZURE_ASSET_CLASSES,
  AZURE_REMEDIATION_ASSET_CLASSES,
  AZURE_REMEDIATOR_SP_APP_ID_PATTERN,
  AZURE_REMEDIATOR_SP_NAME_PREFIX,
  MAX_AZURE_REMEDIATION_PAIRS,
  SAFE_AZURE_SUBSCRIPTION_PATTERN,
  azureFindingToAssetClass,
  azureRemediationKey,
  azureRemediatorSpName,
  getAzureRemediationMapParseError,
  isApprovalGatedAzureAssetClass,
  isAzureRemediationKey,
  normalizeAzureRemediationKey,
  parseAzureRemediationKey,
  parseAzureRemediationMap,
  parseAzureRemediationSecrets,
  serializeAzureRemediationMap,
} from './manifests/azure/remediation-roles';
export type { AzureRemediationAssetClass } from './manifests/azure/remediation-roles';
export { getAzureRemediationScriptForPair } from './manifests/azure/remediation-script';
export type { AzureRemediationScriptPair } from './manifests/azure/remediation-script';

// Shared AWS STS AssumeRole retry (transient / IAM-eventual-consistency safe),
// reused by the Cloud Tests scanner in apps/api.
export { isRetryableAssumeError, retryAssume } from './manifests/aws/checks/assume-retry';

// API Response types (for frontend and API type sharing)
export type {
  CheckRunFindingResponse,
  CheckRunHistoryItemResponse,
  CheckRunPassingResponse,
  ConnectionListItemResponse,
  ConnectionStatusValue,
  CreateConnectionResponse,
  IntegrationConnectionResponse,
  IntegrationProviderResponse,
  OAuthAvailabilityResponse,
  OAuthStartResponse,
  TaskIntegrationCheckResponse,
  TestConnectionResponse,
  VariableOptionResponse,
} from './api-types';
