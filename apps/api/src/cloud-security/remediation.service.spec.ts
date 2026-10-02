import { db } from '@db';
import { RemediationService } from './remediation.service';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { AWSSecurityService } from './providers/aws-security.service';
import { AiRemediationService } from './ai-remediation.service';
import { GcpRemediationService } from './gcp-remediation.service';
import { AzureRemediationService } from './azure-remediation.service';
import { executePlanSteps } from './aws-command-executor';
import { buildStaticPermissionScript } from './remediation-permission-script';
import { readRemediatorRolePermissions } from './remediation-role-reader';

jest.mock('./remediation-role-reader', () => ({
  readRemediatorRolePermissions: jest.fn(),
}));

const mockReadRemediatorRolePermissions =
  readRemediatorRolePermissions as jest.Mock;

jest.mock('@db', () => ({
  db: {
    integrationConnection: { findFirst: jest.fn() },
    integrationCheckResult: { findFirst: jest.fn() },
    remediationAction: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
  Prisma: {},
}));

// executePlanSteps performs real AWS calls — mock only it and keep every
// other validator/normalizer real so the wiring test stays honest.
jest.mock('./aws-command-executor', () => {
  const actual = jest.requireActual('./aws-command-executor');
  return { ...actual, executePlanSteps: jest.fn() };
});

const mockExecutePlanSteps = executePlanSteps as jest.Mock;

const mockDb = db as unknown as {
  integrationConnection: { findFirst: jest.Mock };
  integrationCheckResult: { findFirst: jest.Mock };
  remediationAction: {
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findFirst: jest.Mock;
  };
};

function makeService(params?: {
  credentialVaultService?: Partial<CredentialVaultService>;
  awsSecurityService?: Partial<AWSSecurityService>;
  aiRemediationService?: Partial<AiRemediationService>;
}): RemediationService {
  const credentialVaultService = {
    getDecryptedCredentials: jest.fn(),
    ...(params?.credentialVaultService ?? {}),
  };
  const awsSecurityService = {
    ...(params?.awsSecurityService ?? {}),
  };
  const aiRemediationService = {
    suggestPermissionFix: jest.fn(),
    ...(params?.aiRemediationService ?? {}),
  };

  return new RemediationService(
    credentialVaultService as unknown as CredentialVaultService,
    awsSecurityService as unknown as AWSSecurityService,
    aiRemediationService as unknown as AiRemediationService,
    {} as unknown as GcpRemediationService,
    {} as unknown as AzureRemediationService,
  );
}

function parseGrantedActions(script: string): string[] {
  // Merge-safe scripts carry the grant list in NEW='<json>' and merge it
  // with the live policy at run time (get-role-policy + jq union).
  const match = script.match(/\nNEW='(\[.*?\])'/);
  if (!match?.[1]) throw new Error('no granted action list in script');
  return JSON.parse(match[1]) as string[];
}

describe('RemediationService.previewRemediation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns manual previews without requiring decrypted AWS credentials', async () => {
    const getDecryptedCredentials = jest.fn();
    const service = makeService({
      credentialVaultService: { getDecryptedCredentials },
    });

    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_123',
      provider: { slug: 'aws' },
    });
    mockDb.integrationCheckResult.findFirst.mockResolvedValue({
      id: 'chk_123',
      title: 'RDS instance is not encrypted',
      description: 'RDS encryption requires snapshot copy and restore.',
      severity: 'high',
      resourceId: 'arn:aws:rds:us-east-1:123456789012:db:test',
      resourceType: 'AwsRdsDbInstance',
      evidence: { findingKey: 'rds-encryption-test' },
      remediation:
        '[MANUAL] Cannot be auto-fixed. RDS encryption can only be enabled at creation time.',
    });

    const preview = await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 'rds-encryption-test',
    });

    expect(preview.guidedOnly).toBe(true);
    expect(preview.apiCalls).toEqual([]);
    expect(getDecryptedCredentials).not.toHaveBeenCalled();
  });
});

describe('buildStaticPermissionScript (denylist)', () => {
  const callBuild = (permissions: string[]): string =>
    buildStaticPermissionScript(permissions);

  it('emits a plain Allow statement when everything is grantable', () => {
    const script = callBuild([
      's3:PutBucketEncryption',
      'logs:PutMetricFilter',
    ]);
    const granted = parseGrantedActions(script);
    expect(granted).toEqual(['logs:PutMetricFilter', 's3:PutBucketEncryption']);
    expect(script).not.toContain('WARNING');
    // Read-merge-write: never a bare replace of the live policy.
    expect(script).toContain('get-role-policy');
    expect(script).toContain('MERGED=');
  });

  it('omits denylisted actions with a warning instead of Allow (never Deny)', () => {
    const script = callBuild([
      's3:PutBucketEncryption',
      'iam:PutRolePolicy',
      'sns:Subscribe',
      'guardduty:DeleteDetector',
    ]);
    expect(script).toContain('WARNING');
    const granted = parseGrantedActions(script);
    // Allow-only: a Deny would override a later manual Allow in the console.
    expect(granted).toEqual(['s3:PutBucketEncryption']);
    expect(script).toContain('iam:PutRolePolicy');
  });

  it('returns a manual-review comment (no policy) when every action is blocked', () => {
    const script = callBuild(['iam:PassRole', 's3:PutBucketPolicy']);
    expect(script).toContain('manual review');
    expect(script).not.toContain('--policy-document');
    // The comment names the blocked actions so the reader knows what to review.
    expect(script).toContain('iam:PassRole');
    expect(script).toContain('s3:PutBucketPolicy');
  });

  it('dedupes the all-blocked count instead of reporting raw input length', () => {
    const script = callBuild(['iam:PassRole', 'iam:PassRole']);
    expect(script).toContain('(1)');
    expect(script).not.toContain('(2)');
  });

  it('returns a manual-review comment when there is nothing to grant', () => {
    expect(callBuild([])).toContain('manual review');
  });

  it('treats malformed tokens as blocked, never as granted actions', () => {
    const script = callBuild(['(could not determine specific action)']);
    expect(script).toContain('manual review');
    expect(script).not.toContain('--policy-document');
  });

  it('blocks centrally-covered gaps even on this path', () => {
    const script = callBuild(['s3:PutBucketAcl', 'sts:AssumeRole']);
    expect(script).toContain('manual review');
    expect(script).not.toContain('--policy-document');
  });
});

describe('RemediationService.isUsablePlan (plan-cache guard)', () => {
  const service = makeService();
  const callIsUsable = (plan: unknown): boolean =>
    (
      service as unknown as { isUsablePlan: (p: unknown) => boolean }
    ).isUsablePlan(plan);

  it('treats an empty fix plan as unusable so it is never cached/reused (Retry can regenerate)', () => {
    expect(callIsUsable({ canAutoFix: true, fixSteps: [] })).toBe(false);
  });

  it('treats a non-auto-fixable plan as unusable', () => {
    expect(
      callIsUsable({ canAutoFix: false, fixSteps: [{ command: 'X' }] }),
    ).toBe(false);
  });

  it('treats undefined as unusable', () => {
    expect(callIsUsable(undefined)).toBe(false);
  });

  it('treats an auto-fixable plan with at least one fix step as usable', () => {
    expect(
      callIsUsable({
        canAutoFix: true,
        fixSteps: [{ command: 'PutConfigurationRecorderCommand' }],
      }),
    ).toBe(true);
  });
});

describe('RemediationService.buildExecutePermissionFix (execute fallback)', () => {
  type FixArgs = {
    errorMessage: string;
    failedStep: {
      service: string;
      command: string;
      params: Record<string, unknown>;
      purpose: string;
    };
    fallbackPermissions: string[];
  };
  type FixResult = {
    missingActions: string[];
    fixScript?: string;
    blockedPermissions?: string[];
    blockedPermissionsMessage?: string;
  };
  const callFix = (
    service: RemediationService,
    args: FixArgs,
  ): Promise<FixResult> =>
    (
      service as unknown as {
        buildExecutePermissionFix: (a: FixArgs) => Promise<FixResult>;
      }
    ).buildExecutePermissionFix(args);

  const failedStep = {
    service: 's3',
    command: 'PutBucketEncryptionCommand',
    params: {},
    purpose: 'Enable encryption',
  };

  it('merges cached permissions with AI-discovered ones and flags blocked actions', async () => {
    const suggestPermissionFix = jest.fn().mockResolvedValue({
      missingActions: ['s3:PutBucketEncryption'],
      blockedActions: ['iam:PassRole'],
      policyStatement: {
        Effect: 'Allow',
        Action: ['s3:PutBucketEncryption'],
        Resource: '*',
      },
      fixScript: 'aws iam put-role-policy',
    });
    const service = makeService({
      aiRemediationService: { suggestPermissionFix },
    });

    const result = await callFix(service, {
      errorMessage: 'not authorized to perform: iam:PassRole',
      failedStep,
      fallbackPermissions: ['logs:PutMetricFilter'],
    });

    expect(result.missingActions).toEqual(['s3:PutBucketEncryption']);
    expect(result.blockedPermissions).toEqual(['iam:PassRole']);
    expect(result.blockedPermissionsMessage).toContain('manual review');
    expect(result.fixScript).toContain('WARNING');
    expect(result.fixScript).toContain('iam:PassRole');
    // The step that actually failed must reach the AI unchanged — never
    // substituted with plan.fixSteps[0] (wrong for failures past step one).
    expect(suggestPermissionFix).toHaveBeenCalledWith(
      expect.objectContaining({ failedStep }),
    );
    const granted = parseGrantedActions(result.fixScript as string);
    expect(granted).toEqual(['logs:PutMetricFilter', 's3:PutBucketEncryption']);
  });

  it('surfaces fallback-list blocked actions, not just suggestion-blocked ones', async () => {
    const suggestPermissionFix = jest.fn().mockResolvedValue({
      missingActions: ['s3:PutBucketEncryption'],
      blockedActions: [],
      policyStatement: {
        Effect: 'Allow',
        Action: ['s3:PutBucketEncryption'],
        Resource: '*',
      },
      fixScript: 'aws iam put-role-policy',
    });
    const service = makeService({
      aiRemediationService: { suggestPermissionFix },
    });

    // Execute-without-preview: the fallback is the raw plan list, which can
    // itself hold a denylisted action the AI suggestion never mentions.
    const result = await callFix(service, {
      errorMessage: 'not authorized to perform: s3:PutBucketEncryption',
      failedStep,
      fallbackPermissions: ['iam:PassRole'],
    });

    expect(result.missingActions).toEqual(['s3:PutBucketEncryption']);
    expect(result.blockedPermissions).toEqual(['iam:PassRole']);
    expect(result.blockedPermissionsMessage).toContain('manual review');
    expect(result.fixScript).toContain('iam:PassRole');
  });

  it('filters error-derived actions through the denylist when the AI call fails', async () => {
    const suggestPermissionFix = jest
      .fn()
      .mockRejectedValue(new Error('model down'));
    const service = makeService({
      aiRemediationService: { suggestPermissionFix },
    });

    const result = await callFix(service, {
      errorMessage: 'not authorized to perform: iam:PassRole',
      failedStep,
      fallbackPermissions: ['logs:PutMetricFilter'],
    });

    // The blocked culprit surfaces as blocked — never as a grantable action.
    expect(result.missingActions).toEqual([]);
    expect(result.blockedPermissions).toEqual(['iam:PassRole']);
    expect(result.blockedPermissionsMessage).toContain('manual review');
    expect(result.fixScript).toContain('manual review');
    expect(result.fixScript).not.toContain('--policy-document');
  });

  it('still grants error-derived actions that pass the denylist when the AI call fails', async () => {
    const suggestPermissionFix = jest
      .fn()
      .mockRejectedValue(new Error('model down'));
    const service = makeService({
      aiRemediationService: { suggestPermissionFix },
    });

    const result = await callFix(service, {
      errorMessage: 'not authorized to perform: s3:PutBucketEncryption',
      failedStep,
      fallbackPermissions: [],
    });

    expect(result.missingActions).toEqual(['s3:PutBucketEncryption']);
    expect(result.blockedPermissions).toBeUndefined();
    expect(result.fixScript).toContain('--policy-document');
    expect(result.fixScript).not.toContain('WARNING');
  });
});

describe('RemediationService.previewRemediation (denylist wiring)', () => {
  const connection = { id: 'conn_123', provider: { slug: 'aws' } };
  const finding = {
    id: 'chk_123',
    title: 'S3 bucket is not encrypted',
    description: 'Server-side encryption is not enabled.',
    severity: 'high',
    resourceId: 'test-bucket',
    resourceType: 'AwsS3Bucket',
    evidence: { findingKey: 's3-encryption-test' },
    remediation: 'Enable default encryption on the bucket.',
  };
  const previewParams = {
    connectionId: 'conn_123',
    organizationId: 'org_123',
    checkResultId: 'chk_123',
    remediationKey: 's3-encryption-test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.integrationConnection.findFirst.mockResolvedValue(connection);
    mockDb.integrationCheckResult.findFirst.mockResolvedValue(finding);
  });

  it('surfaces blocked actions for manual review on the no-read-steps fallback path', async () => {
    const generateFixPlan = jest.fn().mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'Enable bucket encryption.',
      currentState: {},
      proposedState: {},
      requiredPermissions: ['s3:PutBucketEncryption', 'iam:PassRole'],
      readSteps: [],
      fixSteps: [
        {
          service: 's3',
          command: 'PutBucketEncryptionCommand',
          params: {},
          purpose: 'Enable encryption',
        },
      ],
      rollbackSteps: [],
      rollbackSupported: false,
    });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      aiRemediationService: { generateFixPlan },
    });

    const preview = (await service.previewRemediation(
      previewParams,
    )) as unknown as {
      blockedPermissions?: string[];
      blockedPermissionsMessage?: string;
      allRequiredPermissions?: string[];
      apiCalls?: string[];
    };

    // The denylisted action is flagged, never silently listed as required.
    expect(preview.blockedPermissions).toEqual(['iam:PassRole']);
    expect(preview.blockedPermissionsMessage).toContain('manual review');
    expect(preview.allRequiredPermissions).toEqual(['s3:PutBucketEncryption']);
    expect(preview.apiCalls).toEqual([
      's3:PutBucketEncryption',
      'iam:PassRole',
    ]);
  });

  it('filters AI-suggested permissions and reports missing ones on the refined path', async () => {
    const readStep = {
      service: 's3',
      command: 'GetBucketEncryptionCommand',
      params: {},
      purpose: 'encryption',
    };
    const fixStep = {
      service: 's3',
      command: 'PutBucketEncryptionCommand',
      params: {},
      purpose: 'Enable encryption',
    };
    const generateFixPlan = jest.fn().mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'Enable bucket encryption.',
      currentState: {},
      proposedState: {},
      requiredPermissions: ['s3:PutBucketEncryption'],
      readSteps: [readStep],
      fixSteps: [fixStep],
      rollbackSteps: [],
      rollbackSupported: false,
    });
    const refineFixPlan = jest.fn().mockResolvedValue({
      canAutoFix: true,
      risk: 'medium',
      description: 'Enable bucket encryption.',
      currentState: {},
      proposedState: {},
      requiredPermissions: ['s3:PutBucketEncryption'],
      readSteps: [readStep],
      fixSteps: [fixStep],
      rollbackSteps: [],
      rollbackSupported: false,
    });
    const analyzeRequiredPermissions = jest
      .fn()
      .mockResolvedValue(['s3:PutBucketEncryption', 'iam:PassRole']);
    mockExecutePlanSteps.mockResolvedValue({
      results: [{ step: { purpose: 'encryption' }, output: {} }],
    });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'AKID', secretAccessKey: 'x' }),
      },
      aiRemediationService: {
        generateFixPlan,
        refineFixPlan,
        analyzeRequiredPermissions,
      },
    });
    // The role already holds the read permission — only the write is missing.
    mockReadRemediatorRolePermissions.mockResolvedValue({
      allowed: new Set(['s3:GetBucketEncryption']),
      denied: new Set(),
    });

    const preview = (await service.previewRemediation(
      previewParams,
    )) as unknown as {
      blockedPermissions?: string[];
      blockedPermissionsMessage?: string;
      allRequiredPermissions?: string[];
      missingPermissions?: string[];
      permissionFixScript?: string;
    };

    expect(preview.blockedPermissions).toEqual(['iam:PassRole']);
    expect(preview.blockedPermissionsMessage).toContain('manual review');
    expect(preview.allRequiredPermissions).toEqual([
      's3:GetBucketEncryption',
      's3:PutBucketEncryption',
    ]);
    expect(preview.missingPermissions).toEqual(['s3:PutBucketEncryption']);
    const granted = parseGrantedActions(preview.permissionFixScript as string);
    expect(granted).not.toContain('iam:PassRole');
  });
});

describe('RemediationService.previewRemediation (recheck mode)', () => {
  const connection = { id: 'conn_123', provider: { slug: 'aws' } };
  const finding = {
    id: 'chk_123',
    title: 'S3 bucket is not encrypted',
    description: 'Server-side encryption is not enabled.',
    severity: 'high',
    resourceId: 'test-bucket',
    resourceType: 'AwsS3Bucket',
    evidence: { findingKey: 's3-encryption-test' },
    remediation: 'Enable default encryption on the bucket.',
  };
  const cacheKey = 'conn_123:chk_123:s3-encryption-test';

  function makeRecheckService(
    existingActions: Set<string> | Error,
    deniedActions: Set<string> = new Set(),
  ): RemediationService {
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'AKID', secretAccessKey: 'x' }),
      },
    });
    if (existingActions instanceof Error) {
      mockReadRemediatorRolePermissions.mockRejectedValue(existingActions);
    } else {
      mockReadRemediatorRolePermissions.mockResolvedValue({
        allowed: existingActions,
        denied: deniedActions,
      });
    }
    return service;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.integrationConnection.findFirst.mockResolvedValue(connection);
    mockDb.integrationCheckResult.findFirst.mockResolvedValue(finding);
  });

  it('splits denylisted actions out of the frontend list', async () => {
    const service = makeRecheckService(
      new Set(['s3:PutBucketEncryption', 's3:GetBucketEncryption']),
    );

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption', 'iam:PassRole'],
    })) as unknown as {
      blockedPermissions?: string[];
      blockedPermissionsMessage?: string;
      allRequiredPermissions?: string[];
      missingPermissions?: string[];
      permissionFixScript?: string;
    };

    // iam:PassRole is surfaced for manual review, never as ordinary missing.
    expect(preview.blockedPermissions).toEqual(['iam:PassRole']);
    expect(preview.blockedPermissionsMessage).toContain('manual review');
    expect(preview.allRequiredPermissions).toEqual(['s3:PutBucketEncryption']);
    expect(preview.missingPermissions).toBeUndefined();
    expect(preview.permissionFixScript).toBeUndefined();
  });

  it('filters the role-read-failure fallback through the denylist', async () => {
    const service = makeRecheckService(new Error('iam read denied'));

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption', 'iam:PassRole'],
    })) as unknown as {
      blockedPermissions?: string[];
      allRequiredPermissions?: string[];
      missingPermissions?: string[];
      permissionFixScript?: string;
      needsFreshPreview?: string;
    };

    expect(preview.missingPermissions).toEqual(['s3:PutBucketEncryption']);
    expect(preview.blockedPermissions).toEqual(['iam:PassRole']);
    // No fresh backend plan behind this recheck — the client list is
    // display-only, so no grant script is minted from it. The caller runs a
    // full preview to get a server-derived script.
    expect(preview.permissionFixScript).toBeUndefined();
    expect(preview.needsFreshPreview).toContain('fresh preview');
  });

  it('reports a specifically-denied action as missing despite a wildcard allow', async () => {
    const service = makeRecheckService(
      new Set(['s3:*']),
      new Set(['s3:PutBucketEncryption']),
    );

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption'],
    })) as unknown as {
      missingPermissions?: string[];
    };

    // Explicit deny wins over the wildcard allow — the gate must not
    // report ready for an action IAM would refuse at execution.
    expect(preview.missingPermissions).toEqual(['s3:PutBucketEncryption']);
  });

  it('keeps the blocked warning on a fresh-cache recheck', async () => {
    const service = makeRecheckService(new Set(['s3:PutBucketEncryption']));
    (
      service as unknown as {
        planCache: Map<
          string,
          {
            plan: unknown;
            timestamp: number;
            permissionsList?: string[];
            blockedPermissionsList?: string[];
          }
        >;
      }
    ).planCache.set(cacheKey, {
      plan: {
        canAutoFix: true,
        description: 'cached plan',
        requiredPermissions: ['s3:PutBucketEncryption'],
        fixSteps: [
          {
            service: 's3',
            command: 'PutBucketEncryptionCommand',
            params: {},
          },
        ],
      },
      timestamp: Date.now(),
      permissionsList: ['s3:PutBucketEncryption'],
      blockedPermissionsList: ['iam:PassRole'],
    });

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption'],
    })) as unknown as {
      blockedPermissions?: string[];
      missingPermissions?: string[];
    };

    // The cached list is grantable-only, so the warning must come from the
    // stored blocked list — it must not vanish on recheck.
    expect(preview.blockedPermissions).toEqual(['iam:PassRole']);
    expect(preview.missingPermissions).toBeUndefined();
  });

  it('mints the fix script from the server plan on a fresh-cache recheck', async () => {
    const service = makeRecheckService(new Set());
    (
      service as unknown as {
        planCache: Map<
          string,
          {
            plan: unknown;
            timestamp: number;
            permissionsList?: string[];
            blockedPermissionsList?: string[];
          }
        >;
      }
    ).planCache.set(cacheKey, {
      plan: {
        canAutoFix: true,
        description: 'cached plan',
        requiredPermissions: ['s3:PutBucketEncryption'],
        fixSteps: [
          {
            service: 's3',
            command: 'PutBucketEncryptionCommand',
            params: {},
          },
        ],
      },
      timestamp: Date.now(),
      permissionsList: ['s3:PutBucketEncryption'],
      blockedPermissionsList: [],
    });

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption'],
    })) as unknown as {
      missingPermissions?: string[];
      permissionFixScript?: string;
      needsFreshPreview?: string;
    };

    // The role lacks the permission and the backend plan is fresh — the
    // script derives from the server list, never the client copy.
    expect(preview.missingPermissions).toEqual(['s3:PutBucketEncryption']);
    const granted = parseGrantedActions(preview.permissionFixScript as string);
    expect(granted).toEqual(['s3:PutBucketEncryption']);
    expect(preview.needsFreshPreview).toBeUndefined();
  });

  it('ignores stale cached plans instead of serving them', async () => {
    const service = makeRecheckService(new Set(['s3:PutBucketEncryption']));
    (
      service as unknown as {
        planCache: Map<
          string,
          { plan: unknown; timestamp: number; permissionsList?: string[] }
        >;
      }
    ).planCache.set(cacheKey, {
      plan: {
        canAutoFix: false,
        description: 'stale dead plan',
        requiredPermissions: [],
        fixSteps: [],
      },
      timestamp: 0,
      permissionsList: ['s3:StalePerm'],
    });

    const preview = (await service.previewRemediation({
      connectionId: 'conn_123',
      organizationId: 'org_123',
      checkResultId: 'chk_123',
      remediationKey: 's3-encryption-test',
      cachedPermissions: ['s3:PutBucketEncryption'],
    })) as unknown as {
      description?: string;
      allRequiredPermissions?: string[];
    };

    // The stale entry is not served: fresh recheck copy, live list.
    expect(preview.description).toBe('Recheck permissions');
    expect(preview.allRequiredPermissions).toEqual(['s3:PutBucketEncryption']);
  });
});

describe('RemediationService.executeRemediation (rollback surfacing)', () => {
  const fixStep = {
    service: 's3',
    command: 'PutBucketVersioningCommand',
    params: {
      Bucket: 'b',
      VersioningConfiguration: { Status: 'Enabled' },
    },
    purpose: 'Enable versioning',
  };
  const rollbackStep = {
    service: 's3',
    command: 'DeleteBucketCommand',
    params: { Bucket: 'b' },
    purpose: 'Undo versioning fix',
  };

  function setupExecuteMocks(params: {
    fixErrorMessage: string;
    rollbackError?: string;
    rollbackSkipped?: string;
    fixSteps?: (typeof fixStep)[];
    rollbackSteps?: (typeof rollbackStep)[];
    skippedResults?: boolean;
  }) {
    mockDb.integrationConnection.findFirst.mockResolvedValue({
      id: 'conn_123',
      provider: { slug: 'aws' },
    });
    mockDb.integrationCheckResult.findFirst.mockResolvedValue({
      id: 'chk_123',
      title: 'Bucket versioning disabled',
      description: 'Versioning is not enabled on the bucket.',
      severity: 'high',
      resourceId: 'arn:aws:s3:::example-bucket',
      resourceType: 'AwsS3Bucket',
      evidence: { findingKey: 's3-versioning', region: 'us-east-1' },
      remediation: 'Use s3:PutBucketVersioningCommand with Status Enabled.',
    });
    mockDb.remediationAction.create.mockResolvedValue({ id: 'act_123' });
    mockDb.remediationAction.update.mockResolvedValue({});

    const plan = {
      canAutoFix: true,
      risk: 'low',
      description: 'Enable versioning',
      currentState: {},
      proposedState: {},
      requiredPermissions: ['s3:PutBucketVersioning'],
      readSteps: [],
      fixSteps: params.fixSteps ?? [fixStep],
      rollbackSteps: params.rollbackSteps ?? [rollbackStep],
      rollbackSupported: true,
      requiresAcknowledgment: false,
    };
    const aiRemediationService = {
      generateFixPlan: jest.fn().mockResolvedValue(plan),
      refineFixPlan: jest.fn().mockResolvedValue(plan),
      // Echo the failure context as the customer-facing reason so the
      // test can assert on what the service passes down.
      generateManualSteps: jest
        .fn()
        .mockImplementation(async (args: { failureReason: string }) => ({
          guidedSteps: ['manual step'],
          reason: args.failureReason,
        })),
      suggestPermissionFix: jest.fn().mockResolvedValue({
        missingActions: ['s3:PutBucketVersioning'],
        blockedActions: [],
        policyStatement: {
          Effect: 'Allow',
          Action: ['s3:PutBucketVersioning'],
          Resource: '*',
        },
        fixScript: 'aws iam put-role-policy ...',
      }),
    };
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
      aiRemediationService,
    });

    mockExecutePlanSteps.mockResolvedValue(
      params.skippedResults
        ? {
            results: [
              {
                step: fixStep,
                output: { _skipped: true, reason: 'missing dependency' },
              },
            ],
          }
        : {
            results: [{ step: fixStep, output: {} }],
            error: {
              stepIndex: 0,
              message: params.fixErrorMessage,
              step: fixStep,
            },
            ...(params.rollbackError !== undefined && {
              rollbackError: params.rollbackError,
            }),
            ...(params.rollbackSkipped !== undefined && {
              rollbackSkipped: params.rollbackSkipped,
            }),
          },
    );

    return service;
  }

  const executeParams = {
    connectionId: 'conn_123',
    organizationId: 'org_123',
    checkResultId: 'chk_123',
    remediationKey: 's3-versioning',
    userId: 'user_123',
    acknowledgment: 'acknowledged',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns about partial state when auto-rollback fails on a non-permission error', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'InternalError: step failed unexpectedly',
      rollbackError: 'AccessDenied: cannot delete bucket',
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
    };

    expect(result.error).toContain('partially modified');
    // The raw rollback AWS text reaches the manual-steps context (AI
    // input), so guidance can name the cause.
    expect(result.error).toContain('AccessDenied: cannot delete bucket');
  });

  it('stays silent about rollback when auto-rollback succeeds', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'InternalError: step failed unexpectedly',
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
    };

    expect(result.error).not.toContain('partially modified');
  });

  it('warns generically on the permission path without leaking the raw rollback text', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'not authorized to perform: s3:PutBucketVersioning',
      rollbackError:
        'not authorized to perform: s3:DeleteBucketVersioning on resource',
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
    };

    // Generic note only: the frontend parses this string for IAM actions,
    // so the raw rollback message (which names another action) must not
    // ride along and get extracted as a missing permission.
    expect(result.error).toContain('partially modified');
    expect(result.error).not.toContain('DeleteBucketVersioning');
  });

  it('routes to manual steps when rollback steps cannot be paired with fix steps', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'InternalError: step failed unexpectedly',
      fixSteps: [fixStep, { ...fixStep, purpose: 'Second fix step' }],
      rollbackSteps: [rollbackStep],
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
      guidedSteps?: string[];
    };

    expect(result.error).toContain('cannot be paired');
    expect(result.guidedSteps).toEqual(['manual step']);
    // Pairing validation happens before Phase 3 — the fix steps never
    // executed (only the empty Phase-1 read call ran).
    const executedFixCalls = mockExecutePlanSteps.mock.calls.filter(
      (call: { steps?: unknown[] }) => (call.steps ?? []).length > 0,
    );
    expect(executedFixCalls).toEqual([]);
  });

  it('fails loudly when a step was skipped instead of reporting success', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'unused',
      skippedResults: true,
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
      guidedSteps?: string[];
    };

    // A skipped step never ran — it must surface as a failure with manual
    // follow-up, never as a successful remediation.
    expect(result.error).toContain('Skipped 1 step(s)');
    expect(result.guidedSteps).toEqual(['manual step']);
    const updateCall = (
      mockDb.remediationAction.update.mock.calls as Array<
        Array<{ data?: { status?: string } }>
      >
    ).find((args) => args[0]?.data?.status === 'failed');
    expect(updateCall).toBeDefined();
  });

  it('warns about partial state when auto-rollback was skipped as unpairable', async () => {
    const service = setupExecuteMocks({
      fixErrorMessage: 'InternalError: step failed unexpectedly',
      rollbackSkipped:
        'Auto-rollback skipped: 1 rollback step(s) for 2 fix step(s)',
    });

    const result = (await service.executeRemediation(executeParams)) as {
      error?: string;
    };

    expect(result.error).toContain('partially modified');
    expect(result.error).toContain('was skipped');
  });
});

describe('RemediationService.rollbackRemediation (blocked split)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('splits denylisted actions out of the rollback permission error', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'success',
      connectionId: 'conn_123',
      remediationKey: 's3-versioning',
      resourceId: 'b',
      appliedState: {
        rollbackSteps: [
          {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
        ],
      },
      connection: { provider: { slug: 'aws' } },
    });
    mockDb.remediationAction.update.mockResolvedValue({});
    mockDb.remediationAction.updateMany.mockResolvedValue({ count: 1 });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
    });
    mockExecutePlanSteps.mockRejectedValueOnce(
      new Error('not authorized to perform: iam:PassRole on resource'),
    );

    const failure = await service
      .rollbackRemediation({ actionId: 'act_123', organizationId: 'org_123' })
      .then(
        () => {
          throw new Error('rollback should have thrown');
        },
        (err: Error) => err,
      );
    const payload = JSON.parse(failure.message) as {
      missingActions: string[];
      blockedPermissions?: string[];
      blockedPermissionsMessage?: string;
      script: string;
    };

    // Denylisted action surfaces for manual review, never as grantable.
    expect(payload.blockedPermissions).toEqual(['iam:PassRole']);
    expect(payload.blockedPermissionsMessage).toContain('manual review');
    expect(payload.missingActions).not.toContain('iam:PassRole');
    // Nothing was grantable, so the script is the manual-review notice —
    // it must not carry a one-click grant for the blocked action.
    expect(payload.script).toContain('manual review');
    expect(payload.script).not.toContain('put-role-policy');
  });

  it('fails loudly when a rollback step is skipped instead of recording success', async () => {
    // A skipped undo step never ran — `rolled_back` would hide a partial
    // undo. The flow must record rollback_failed with the gap named.
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'success',
      connectionId: 'conn_123',
      remediationKey: 's3-versioning',
      resourceId: 'b',
      appliedState: {
        rollbackSteps: [
          {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
        ],
      },
      connection: { provider: { slug: 'aws' } },
    });
    mockDb.remediationAction.update.mockResolvedValue({});
    mockDb.remediationAction.updateMany.mockResolvedValue({ count: 1 });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
    });
    mockExecutePlanSteps.mockResolvedValueOnce({
      results: [
        {
          step: {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
          output: { _skipped: true, reason: 'unmet dependency' },
        },
      ],
    });

    await expect(
      service.rollbackRemediation({
        actionId: 'act_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('did not fully apply');
    expect(mockDb.remediationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rollback_failed' }),
      }),
    );
  });

  it('rejects a second concurrent rollback when the claim loses', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'success',
      connectionId: 'conn_123',
      appliedState: {
        // Valid steps so the test reaches the claim race (not re-validation).
        rollbackSteps: [
          {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
        ],
      },
      connection: { provider: { slug: 'aws' } },
    });
    mockDb.remediationAction.updateMany.mockResolvedValue({ count: 0 });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
    });
    await expect(
      service.rollbackRemediation({
        actionId: 'act_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('already in progress');
    expect(mockExecutePlanSteps).not.toHaveBeenCalled();
  });

  it('does not claim the rollback when no rollback steps exist', async () => {
    // Validation runs before the atomic claim: an early throw must leave
    // the status untouched, otherwise the action strands in
    // `rollback_in_progress` and every future rollback is rejected.
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'success',
      connectionId: 'conn_123',
      appliedState: {},
      connection: { provider: { slug: 'aws' } },
    });
    const service = makeService({});
    await expect(
      service.rollbackRemediation({
        actionId: 'act_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('No rollback steps available');
    expect(mockDb.remediationAction.updateMany).not.toHaveBeenCalled();
    expect(mockExecutePlanSteps).not.toHaveBeenCalled();
  });

  it('re-validates stored rollback steps before claiming', async () => {
    // Stored steps were checked at plan time, but the undo runs later —
    // an invalid persisted step must throw before the claim flips status.
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'success',
      connectionId: 'conn_123',
      appliedState: {
        rollbackSteps: [{ service: 's3', command: 'X', params: {} }],
      },
      connection: { provider: { slug: 'aws' } },
    });
    const service = makeService({});
    await expect(
      service.rollbackRemediation({
        actionId: 'act_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('re-validation');
    expect(mockDb.remediationAction.updateMany).not.toHaveBeenCalled();
    expect(mockExecutePlanSteps).not.toHaveBeenCalled();
  });

  it('retries a rollback that previously failed', async () => {
    // A transient failure (e.g. missing permission, since granted) must not
    // brick the action — `rollback_failed` stays eligible for retry.
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'rollback_failed',
      connectionId: 'conn_123',
      remediationKey: 's3-versioning',
      resourceId: 'b',
      appliedState: {
        rollbackSteps: [
          {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
        ],
      },
      connection: { provider: { slug: 'aws' } },
    });
    mockDb.remediationAction.update.mockResolvedValue({});
    mockDb.remediationAction.updateMany.mockResolvedValue({ count: 1 });
    mockExecutePlanSteps.mockResolvedValue({
      results: [{ step: { purpose: 'rollback' }, output: {} }],
    });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
    });

    const result = await service.rollbackRemediation({
      actionId: 'act_123',
      organizationId: 'org_123',
    });

    expect(result.status).toBe('rolled_back');
    expect(mockDb.remediationAction.update).toHaveBeenCalledWith({
      where: { id: 'act_123' },
      data: { status: 'rolled_back', rolledBackAt: expect.any(Date) },
    });
  });

  it('reclaims a stale in-progress claim from a crashed process', async () => {
    // The claim write bumps updatedAt, so a claim older than the timeout
    // cannot belong to a live holder — only to a process that died between
    // claim and settle.
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'rollback_in_progress',
      updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      connectionId: 'conn_123',
      remediationKey: 's3-versioning',
      resourceId: 'b',
      appliedState: {
        rollbackSteps: [
          {
            service: 's3',
            command: 'DeleteBucketCommand',
            params: { Bucket: 'b' },
          },
        ],
      },
      connection: { provider: { slug: 'aws' } },
    });
    mockDb.remediationAction.update.mockResolvedValue({});
    mockDb.remediationAction.updateMany.mockResolvedValue({ count: 1 });
    mockExecutePlanSteps.mockResolvedValue({
      results: [{ step: { purpose: 'rollback' }, output: {} }],
    });
    const service = makeService({
      credentialVaultService: {
        getDecryptedCredentials: jest
          .fn()
          .mockResolvedValue({ regions: ['us-east-1'] }),
      },
      awsSecurityService: {
        assumeRemediationRole: jest
          .fn()
          .mockResolvedValue({ accessKeyId: 'a', secretAccessKey: 'b' }),
      },
    });

    const result = await service.rollbackRemediation({
      actionId: 'act_123',
      organizationId: 'org_123',
    });

    expect(result.status).toBe('rolled_back');
    // The claim filter admits the stale claim at write time.
    expect(mockDb.remediationAction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'act_123',
        OR: [
          { status: { in: ['success', 'unverified', 'rollback_failed'] } },
          {
            status: 'rollback_in_progress',
            updatedAt: { lt: expect.any(Date) },
          },
        ],
      },
      data: { status: 'rollback_in_progress' },
    });
  });

  it('rejects a fresh in-progress claim without touching it', async () => {
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_123',
      status: 'rollback_in_progress',
      updatedAt: new Date(),
      connectionId: 'conn_123',
      appliedState: {
        rollbackSteps: [{ service: 's3', command: 'X', params: {} }],
      },
      connection: { provider: { slug: 'aws' } },
    });
    const service = makeService({});
    await expect(
      service.rollbackRemediation({
        actionId: 'act_123',
        organizationId: 'org_123',
      }),
    ).rejects.toThrow('Cannot rollback action with status');
    expect(mockDb.remediationAction.updateMany).not.toHaveBeenCalled();
    expect(mockExecutePlanSteps).not.toHaveBeenCalled();
  });
});
