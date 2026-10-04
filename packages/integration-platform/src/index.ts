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
export {
  awsRemediationScript,
  getAwsRemediationScript,
  getAwsRemediationScriptForPair,
} from './manifests/aws/remediation-script';
export type { RemediationScriptPair } from './manifests/aws/remediation-script';

// Asset-class x region remediator roles (Phase 2): shared by the API
// (assume routing, validation) and the frontend (per-pair setup UI).
export {
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
  isRemediationRoleKey,
  parseRemediationRolesMap,
  remediationRoleKey,
  remediationRoleName,
  serializeRemediationRolesMap,
} from './manifests/aws/remediation-roles';
export type { RemediationAssetClass } from './manifests/aws/remediation-roles';

// Customer-side CloudTrail detection for the remediator roles (EventBridge
// patterns, Lake queries, SNS wiring script) — consumed by support tooling
// and the docs so the alerts and the queries cannot drift apart.
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
