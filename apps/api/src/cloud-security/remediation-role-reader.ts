import {
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  readRolePermissionSets,
  subtractDeniedActions,
  type RolePolicyReader,
} from './remediation-permission-coverage';

export interface RemediatorCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Read the ACTUAL IAM policies attached to the remediator role and return
 * the allowed actions plus the explicit denies. This is deterministic —
 * no simulation. Covers inline policies AND attached managed policies,
 * single-object and array `Statement` shapes. Callers pass both sets to
 * `isPermissionCoveredBySet` so a specific deny defeats a wildcard allow.
 *
 * Extracted from RemediationService so AWS SDK wiring lives in its own
 * module instead of the god service. The shared paginated reader
 * (`remediation-permission-coverage`) still owns pagination, statement
 * normalization, and deny collection — only the wire calls live here.
 */
export async function readRemediatorRolePermissions(params: {
  credentials: RemediatorCredentials;
  region: string;
  roleName: string;
  onWarn?: (message: string) => void;
  onInfo?: (message: string) => void;
}): Promise<{ allowed: Set<string>; denied: Set<string> }> {
  const iam = new IAMClient({
    region: params.region,
    credentials: {
      accessKeyId: params.credentials.accessKeyId,
      secretAccessKey: params.credentials.secretAccessKey,
      sessionToken: params.credentials.sessionToken,
    },
  });
  const roleName = params.roleName;
  // No legacy default: callers resolve the finding's pair role first and
  // fail closed when none is configured. Reading the monolith here would
  // silently report the wrong role's permissions.
  if (!roleName) {
    throw new Error(
      'Remediation pair role name is required to read role permissions.',
    );
  }

  // Thin SDK adapter over the shared paginated reader.
  const reader: RolePolicyReader = {
    listInlinePolicyNames: async ({ marker }) => {
      const listResp = await iam.send(
        new ListRolePoliciesCommand({ RoleName: roleName, Marker: marker }),
      );
      return {
        names: listResp.PolicyNames ?? [],
        marker: listResp.IsTruncated ? listResp.Marker : undefined,
      };
    },
    getInlinePolicyDocument: async ({ policyName }) => {
      const policyResp = await iam.send(
        new GetRolePolicyCommand({
          RoleName: roleName,
          PolicyName: policyName,
        }),
      );
      // A missing document is an incomplete read, not an empty policy —
      // throw so the caller engages the deny-everything degradation instead
      // of treating "no statements" as "ready".
      if (!policyResp.PolicyDocument) {
        throw new Error(`Missing policy document for ${policyName}`);
      }
      return JSON.parse(decodeURIComponent(policyResp.PolicyDocument));
    },
    listAttachedPolicies: async ({ marker }) => {
      const attachedResp = await iam.send(
        new ListAttachedRolePoliciesCommand({
          RoleName: roleName,
          Marker: marker,
        }),
      );
      return {
        policies: (attachedResp.AttachedPolicies ?? []).map((policy) => ({
          arn: policy.PolicyArn,
          name: policy.PolicyName,
        })),
        marker: attachedResp.IsTruncated ? attachedResp.Marker : undefined,
      };
    },
    getAttachedPolicyDocument: async (policyArn) => {
      const meta = await iam.send(
        new GetPolicyCommand({ PolicyArn: policyArn }),
      );
      const versionId = meta.Policy?.DefaultVersionId;
      if (!versionId) {
        throw new Error(`Missing default version for ${policyArn}`);
      }
      const version = await iam.send(
        new GetPolicyVersionCommand({
          PolicyArn: policyArn,
          VersionId: versionId,
        }),
      );
      if (!version.PolicyVersion?.Document) {
        throw new Error(`Missing policy document for ${policyArn}`);
      }
      return JSON.parse(decodeURIComponent(version.PolicyVersion.Document));
    },
  };

  try {
    const { allowed: actions, denied } = await readRolePermissionSets(
      reader,
      roleName,
      (message) => params.onWarn?.(message),
    );

    // Explicit Deny wins over Allow. Coarse-prune allow entries a deny
    // fully covers, then hand both sets to the caller — the query-time
    // check catches the remaining direction (specific deny against
    // wildcard allow) against each concrete action.
    subtractDeniedActions(actions, denied);
    params.onInfo?.(
      `Total actions found on role: ${actions.size}. Sample: ${[...actions].slice(0, 10).join(', ')}`,
    );
    return { allowed: actions, denied };
  } finally {
    iam.destroy?.();
  }
}
