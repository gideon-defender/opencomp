/**
 * Asset-class x region remediator roles (Phase 2 of the AWS
 * detection/remediation split plan).
 *
 * The monolith `OpenComp-Remediator` role (see `./remediation-script`) holds
 * every fix-forward write on `Resource: "*"` across all regions and asset
 * classes. Per-pair roles (`OpenComp-Remediator-{AssetClass}-{Region}`)
 * scope each role to one asset class in one region with the same
 * 3-statement shape: fix-forward Allow (+ `aws:RequestedRegion` condition),
 * region Deny, destructive Deny.
 *
 * The fix-forward action lists below are split verbatim from the monolith
 * script's policy blocks — no action was added or removed in the split, so
 * a per-pair role grants a strict subset of what the monolith grants.
 * Anything the monolith deliberately omits (IAM writes, Disable/Delete,
 * Subscribe, PutBucketPolicy, …) stays omitted here too; the runtime
 * enforcement point for AI-requested actions remains
 * `@gideon-defender/utils/remediation-denylist`.
 */

export const REMEDIATION_ASSET_CLASSES = [
  'Storage',
  'Compute',
  'Network',
  'Data',
  'Security-Global',
] as const;

export type RemediationAssetClass = (typeof REMEDIATION_ASSET_CLASSES)[number];

/** `Security-Global` covers global services — assumed in us-east-1 only. */
export const SECURITY_GLOBAL_PINNED_REGION = 'us-east-1';

/** AWS region names are lowercase alphanumerics plus hyphens only. */
export const SAFE_AWS_REGION_PATTERN = /^[a-z0-9-]+$/;

/**
 * IAM role-name characters that are safe inside a double-quoted shell
 * string. IAM itself only allows word chars plus `+=,.@-` (and `/` for
 * paths) — every shell metacharacter (`"`, `$`, backtick, `;`, …) is
 * rejected, so a validated name cannot break out of `ROLE="..."`.
 *
 * Keep in sync with `SAFE_ROLE_NAME_PATTERN` in
 * `@gideon-defender/utils/remediation-script` (same IAM charset; separate
 * copy because neither package depends on the other).
 */
export const SAFE_IAM_ROLE_TOKEN_PATTERN = /^[A-Za-z0-9_+=,.@/-]+$/;

/** Legacy monolith remediator role name (deprecated in favor of per-pair roles). */
export const AWS_LEGACY_REMEDIATION_ROLE_NAME = 'OpenComp-Remediator';

/** Prefix for per-asset-class x region remediator roles. */
export const AWS_REMEDIATION_ROLE_NAME_PREFIX = 'OpenComp-Remediator-';

/**
 * Finding `resourceType` (see `IntegrationCheckResult.resourceType`) to
 * asset class. Covers BOTH taxonomies in the wild: the `aws-*` kebab types
 * from the integration-platform checks and the `Aws*` PascalCase types
 * from the legacy API adapters. Unknown types route to `Security-Global`
 * — the human-gated role — so a future check type fails closed to manual
 * approval instead of silently landing in an auto-fix role.
 */
const RESOURCE_TYPE_TO_ASSET_CLASS: Record<string, RemediationAssetClass> = {
  // New checks (integration-platform manifests).
  'aws-s3-bucket': 'Storage',
  'aws-rds': 'Data',
  'aws-rds-cluster': 'Data',
  'aws-rds-instance': 'Data',
  'aws-security-group': 'Compute',
  'aws-kms-key': 'Security-Global',
  'aws-cloudtrail': 'Security-Global',
  'aws-account': 'Security-Global',
  'aws-environment-separation': 'Security-Global',
  // Legacy adapters (apps/api providers).
  AwsS3Bucket: 'Storage',
  S3Bucket: 'Storage',
  AwsDynamoDbTable: 'Storage',
  AwsRedshiftCluster: 'Storage',
  AwsBackupPlan: 'Storage',
  AwsEfsFileSystem: 'Storage',
  AwsAthenaWorkGroup: 'Storage',
  AwsEc2SecurityGroup: 'Compute',
  AwsEc2Vpc: 'Compute',
  AwsLambdaFunction: 'Compute',
  AwsEksCluster: 'Compute',
  AwsEcsTaskDefinition: 'Compute',
  AwsEmrCluster: 'Compute',
  AwsSageMakerNotebook: 'Compute',
  AwsCodeBuildProject: 'Compute',
  AwsStepFunction: 'Compute',
  AwsEcrRepository: 'Compute',
  AwsElbLoadBalancer: 'Network',
  AwsApiGatewayApi: 'Network',
  AwsCloudFrontDistribution: 'Network',
  AwsNetworkFirewall: 'Network',
  AwsTransferServer: 'Network',
  AwsSnsTopic: 'Data',
  AwsSqsQueue: 'Data',
  AwsKinesisStream: 'Data',
  AwsEventBridgeBus: 'Data',
  AwsRdsDbInstance: 'Data',
  AwsOpenSearchDomain: 'Data',
  AwsMskCluster: 'Data',
  AwsNeptuneCluster: 'Data',
  AwsElastiCacheCluster: 'Data',
  AwsSecretsManagerSecret: 'Data',
  AwsSsmParameter: 'Data',
  AwsAppFlow: 'Data',
  AwsAccount: 'Security-Global',
  AwsIamUser: 'Security-Global',
  AwsIamAccessKey: 'Security-Global',
  AwsKmsKey: 'Security-Global',
  AwsCloudTrailTrail: 'Security-Global',
  AwsGuardDutyDetector: 'Security-Global',
  AwsConfigRecorder: 'Security-Global',
  AwsInspectorCoverage: 'Security-Global',
  AwsMacieSession: 'Security-Global',
  AwsCloudWatchAlarm: 'Security-Global',
  AwsCognitoUserPool: 'Security-Global',
  AwsAcmCertificate: 'Security-Global',
  AwsWafWebAcl: 'Security-Global',
  AwsShieldSubscription: 'Security-Global',
};

export function findingToAssetClass(resourceType: unknown): RemediationAssetClass {
  // Own-property check: `in` also matches Object.prototype members, so a
  // resourceType of "toString" or "constructor" would misroute instead of
  // failing closed to Security-Global.
  if (typeof resourceType !== 'string') return 'Security-Global';
  if (!Object.prototype.hasOwnProperty.call(RESOURCE_TYPE_TO_ASSET_CLASS, resourceType)) {
    return 'Security-Global';
  }
  return RESOURCE_TYPE_TO_ASSET_CLASS[resourceType];
}

/** IAM role name for a pair, e.g. `OpenComp-Remediator-Storage-us-east-1`. */
export function remediationRoleName(params: {
  assetClass: RemediationAssetClass;
  region: string;
}): string {
  const region = params.region.trim();
  if (!region) throw new Error('remediationRoleName requires a non-empty region');
  // Fail closed on shell-unsafe input: the name is interpolated into
  // generated CloudShell scripts, so a region carrying quotes or `$()`
  // must throw here instead of producing a poisoned script.
  if (!SAFE_AWS_REGION_PATTERN.test(region)) {
    throw new Error(`remediationRoleName requires a valid AWS region, got "${region}"`);
  }
  if (params.assetClass === 'Security-Global') return 'OpenComp-Remediator-Security-Global';
  return `OpenComp-Remediator-${params.assetClass}-${region}`;
}

/**
 * Credential-map key for a pair, e.g. `Storage:us-east-1`. The global class
 * is pinned to us-east-1 regardless of the finding's region — there is
 * exactly one `Security-Global` role per connection.
 */
export function remediationRoleKey(params: {
  assetClass: RemediationAssetClass;
  region: string;
}): string {
  if (params.assetClass === 'Security-Global') {
    return `Security-Global:${SECURITY_GLOBAL_PINNED_REGION}`;
  }
  const region = params.region.trim();
  if (!region) throw new Error('remediationRoleKey requires a non-empty region');
  if (!SAFE_AWS_REGION_PATTERN.test(region)) {
    throw new Error(`remediationRoleKey requires a valid AWS region, got "${region}"`);
  }
  return `${params.assetClass}:${region}`;
}

/** True when `key` is a well-formed `AssetClass:region` map key. */
export function isRemediationRoleKey(key: string): boolean {
  const separator = key.indexOf(':');
  if (separator <= 0) return false;
  const assetClass = key.slice(0, separator);
  const region = key.slice(separator + 1);
  if (!(REMEDIATION_ASSET_CLASSES as readonly string[]).includes(assetClass)) return false;
  if (assetClass === 'Security-Global') return region === SECURITY_GLOBAL_PINNED_REGION;
  if (!region.trim()) return false;
  return SAFE_AWS_REGION_PATTERN.test(region);
}

/**
 * Escape a value for interpolation inside a double-quoted shell string
 * (`VAR="..."`). Prefixes `"`, `$`, backtick, and `\` with a backslash, and
 * strips carriage returns / newlines outright (a backslash-newline inside
 * double quotes is a line continuation, not an escape — it would still
 * inject a new shell line). Caller-controlled values (external IDs, pasted
 * input) cannot break out of the quotes and inject commands into generated
 * setup scripts.
 */
export function escapeDoubleQuotedShell(value: string): string {
  return value.replace(/[\r\n]/g, '').replace(/(["$`\\])/g, '\\$1');
}

/**
 * Parse the stored `remediationRoles` credential (a JSON string of
 * `{ "Class:region": "arn:..." }`) into a clean record. Accepts an
 * already-parsed record defensively; anything else yields `{}` so callers
 * fail closed to the legacy single ARN instead of throwing on bad input.
 */
export function parseRemediationRolesMap(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, arn] of Object.entries(parsed as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (typeof arn === 'string' && arn.trim()) out[key] = arn.trim();
  }
  return out;
}

/** Serialize a pair map for credential storage (drops blank entries). */
export function serializeRemediationRolesMap(map: Record<string, string>): string {
  return JSON.stringify(parseRemediationRolesMap(map));
}

/**
 * Shared entry check for the RAW `remediationRoles` credential value.
 * Rejects blank keys (the read-path parser drops them, which would fail
 * open to zero entries) and keys that collide after trimming (the parser
 * keeps last-write-wins, silently dropping an ARN without validating it).
 */
function checkRemediationRolesEntries(entries: [string, unknown][]): string | null {
  const seen = new Set<string>();
  for (const [rawKey, arn] of entries) {
    const key = rawKey.trim();
    if (!key) {
      return 'remediationRoles: keys must be non-empty "<AssetClass>:<region>" strings.';
    }
    if (seen.has(key)) {
      return `remediationRoles["${key}"]: duplicate key after trimming whitespace.`;
    }
    seen.add(key);
    if (typeof arn !== 'string' || !arn.trim()) {
      return `remediationRoles["${key}"]: must be a non-empty role ARN string.`;
    }
  }
  return null;
}

/**
 * Fail-open-safe check for the RAW `remediationRoles` credential value.
 * `parseRemediationRolesMap` deliberately yields `{}` for garbage so
 * read-path callers fail closed to the legacy ARN — but validation must
 * surface the garbage instead of looping over zero entries and passing.
 * Returns an error message for non-empty input that is not a JSON object
 * (unparseable text, arrays, primitives), or null when the value is
 * absent/blank (treated as "no pairs") or a JSON object.
 */
export function getRemediationRolesParseError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return checkRemediationRolesEntries(Object.entries(parsed as Record<string, unknown>));
      }
    } catch {
      // Fall through to the error below.
    }
    return 'remediationRoles: must be a JSON object mapping "<AssetClass>:<region>" to role ARN.';
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return checkRemediationRolesEntries(Object.entries(value as Record<string, unknown>));
  }
  return 'remediationRoles: must be a JSON object mapping "<AssetClass>:<region>" to role ARN.';
}

// Re-exported here so `remediation-roles` stays the single import path.
export {
  FIX_FORWARD_ALLOWLIST,
  NEVER_ALLOW_REMEDIATION_ACTIONS,
  buildRemediationPolicyDocument,
} from './remediation-allowlist';
export type { RemediationPolicyDocument } from './remediation-allowlist';
