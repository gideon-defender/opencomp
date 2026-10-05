import { db } from '@db';
import { GcpImpersonationService } from './gcp-impersonation.service';
import {
  GcpRemediationService,
  hashGcpPlanSteps,
} from './gcp-remediation.service';
import { AiRemediationService } from './ai-remediation.service';
import { CredentialVaultService } from '../integration-platform/services/credential-vault.service';
import { OAuthCredentialsService } from '../integration-platform/services/oauth-credentials.service';
import { executeGcpPlanSteps } from './gcp-command-executor';

jest.mock('@db', () => ({
  db: {
    integrationConnection: { findFirst: jest.fn() },
    integrationCheckResult: { findFirst: jest.fn() },
    remediationAction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  },
  Prisma: {},
}));

// executeGcpPlanSteps performs real GCP calls — mock only it and keep
// validation real so the allowlist wiring test stays honest.
jest.mock('./gcp-command-executor', () => {
  const actual = jest.requireActual('./gcp-command-executor');
  return { ...actual, executeGcpPlanSteps: jest.fn() };
});

const mockExecute = executeGcpPlanSteps as jest.Mock;

const mockDb = db as unknown as {
  integrationConnection: { findFirst: jest.Mock };
  integrationCheckResult: { findFirst: jest.Mock };
  remediationAction: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
};

const SA = 'opencomp-remediator@my-proj-123.iam.gserviceaccount.com';
const MAP = JSON.stringify({ 'Storage:my-proj-123': SA });

const STORAGE_FIX = {
  method: 'PATCH' as const,
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  body: { iamConfiguration: {} },
  purpose: 'remove public access',
};

const STORAGE_READ = {
  method: 'GET' as const,
  url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
  purpose: 'read bucket',
};

function storageFinding() {
  return {
    id: 'chk_1',
    title: 'Bucket is public',
    description: 'desc',
    severity: 'high',
    resourceId: 'my-bucket',
    resourceType: 'gcp-storage-bucket',
    remediation: 'Make the bucket private.',
    evidence: { findingKey: 'k', projectId: 'my-proj-123' },
  };
}

function firewallFinding() {
  return {
    ...storageFinding(),
    resourceType: 'gcp-firewall-rule',
    resourceId: 'projects/my-proj-123/global/firewalls/fw',
    evidence: { findingKey: 'k2', projectId: 'my-proj-123' },
  };
}

function makeService(opts?: {
  vaultCreds?: Record<string, unknown>;
  impersonator?: Partial<GcpImpersonationService>;
  aiPlan?: Record<string, unknown>;
}) {
  const getDecryptedCredentials = jest
    .fn()
    .mockResolvedValue(opts?.vaultCreds ?? { access_token: 'auditor-token' });
  const credentialVaultService = {
    getDecryptedCredentials,
    getValidAccessToken: jest.fn().mockResolvedValue('auditor-token'),
  };
  const oauthCredentialsService = {
    getCredentials: jest.fn().mockResolvedValue({
      clientId: 'id',
      clientSecret: 'secret',
      scopes: ['s'],
    }),
  };
  const plan = {
    canAutoFix: true,
    fixSteps: [STORAGE_FIX],
    readSteps: [STORAGE_READ],
    rollbackSteps: [],
    currentState: {},
    proposedState: {},
    description: 'fix',
    risk: 'low',
    rollbackSupported: false,
    ...(opts?.aiPlan ?? {}),
  };
  const aiRemediationService = {
    generateGcpFixPlan: jest.fn().mockResolvedValue(plan),
    refineGcpFixPlan: jest.fn().mockResolvedValue(plan),
  };
  const impersonationService = {
    mintRemediatorToken: jest
      .fn()
      .mockResolvedValue({ accessToken: 'fix-token', expiresInSeconds: 600 }),
    resolveCallerToken: jest.fn().mockReturnValue('backend-token'),
    getImpersonatorEmail: jest.fn(),
    ...(opts?.impersonator ?? {}),
  };
  const service = new GcpRemediationService(
    credentialVaultService as unknown as CredentialVaultService,
    oauthCredentialsService as unknown as OAuthCredentialsService,
    aiRemediationService as unknown as AiRemediationService,
    impersonationService as unknown as GcpImpersonationService,
  );
  return { service, impersonationService, aiRemediationService };
}

function mockFinding(finding: Record<string, unknown>) {
  mockDb.integrationConnection.findFirst.mockResolvedValue({
    id: 'conn_gcp',
    provider: { slug: 'gcp' },
  });
  mockDb.integrationCheckResult.findFirst.mockResolvedValue(finding);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockImplementation(async ({ steps }: { steps: unknown[] }) => ({
    results: steps.map((step) => ({ step, output: { ok: true } })),
  }));
  mockDb.remediationAction.create.mockResolvedValue({ id: 'act_1' });
  mockDb.remediationAction.update.mockResolvedValue({});
});

describe('GcpRemediationService SoD', () => {
  it('preview returns guided-only for approval-gated classes without calling AI', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(firewallFinding());

    const result = await service.previewRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    });

    expect(result.guidedOnly).toBe(true);
    expect(aiRemediationService.generateGcpFixPlan).not.toHaveBeenCalled();
  });

  it('execute refuses when no SA is bound (fail closed, no mint)', async () => {
    const { service, impersonationService } = makeService({
      vaultCreds: { access_token: 'auditor-token' },
    });
    mockFinding(storageFinding());

    await expect(
      service.executeRemediation({
        connectionId: 'conn_gcp',
        organizationId: 'org_1',
        checkResultId: 'chk_1',
        remediationKey: 'fix',
        userId: 'user_1',
        acknowledgment: 'acknowledged',
      }),
    ).rejects.toThrow(/No remediator SA bound for Storage:my-proj-123/);
    expect(impersonationService.mintRemediatorToken).not.toHaveBeenCalled();
  });

  it('execute refuses approval-gated classes even when bound', async () => {
    const networkMap = JSON.stringify({
      'Network:my-proj-123': SA,
    });
    const { service, impersonationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: networkMap },
    });
    mockFinding(firewallFinding());

    await expect(
      service.executeRemediation({
        connectionId: 'conn_gcp',
        organizationId: 'org_1',
        checkResultId: 'chk_1',
        remediationKey: 'fix',
        userId: 'user_1',
        acknowledgment: 'acknowledged',
      }),
    ).rejects.toThrow(/requires human approval/);
    expect(impersonationService.mintRemediatorToken).not.toHaveBeenCalled();
  });

  it('execute writes with the remediator token and reads with the auditor token', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    const result = await service.executeRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
    });

    expect(result.status).toBe('unverified');
    // The mocked executor returns identical read states with no success
    // indicator, so the fix cannot be proven — 'unverified', not 'success'.
    const tokens = mockExecute.mock.calls.map((c) => c[0].accessToken);
    // Reads use the auditor token; the fix execution uses the minted token.
    expect(tokens).toContain('auditor-token');
    expect(tokens).toContain('fix-token');
    const fixCall = mockExecute.mock.calls.find((c) =>
      (c[0].steps as Array<{ purpose: string }>).some(
        (s) => s.purpose === 'remove public access',
      ),
    );
    expect(fixCall).toBeDefined();
    expect(fixCall![0].accessToken).toBe('fix-token');
    // Audit trail records the fix identity.
    expect(mockDb.remediationAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act_1' },
        data: expect.objectContaining({
          appliedState: expect.objectContaining({
            fixIdentity: expect.objectContaining({
              saEmail: SA,
              assetClass: 'Storage',
              tokenTtlSeconds: 600,
            }),
          }),
        }),
      }),
    );
  });

  it('execute reports success only when the re-read shows a state change', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    // First read sees the vulnerable state, the post-fix re-read sees the
    // fixed state. A no-op fix (identical states) must stay 'unverified'.
    let reads = 0;
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ purpose: string }> }) => ({
        results: steps.map((step) => {
          if (step.purpose === 'read bucket') {
            reads += 1;
            return {
              step,
              output:
                reads === 1
                  ? {
                      iamConfiguration: { publicAccessPrevention: 'inherited' },
                    }
                  : {
                      iamConfiguration: { publicAccessPrevention: 'enforced' },
                    },
            };
          }
          return { step, output: { ok: true } };
        }),
      }),
    );

    const result = await service.executeRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
    });

    expect(result.status).toBe('success');
  });

  it('rollback refuses when no SA is bound', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token' },
    });
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      status: 'success',
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      appliedState: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            purpose: 'rollback',
          },
        ],
      },
      remediationKey: 'fix',
      resourceId: 'projects/my-proj-123/buckets/my-bucket',
      resourceType: 'gcp-storage-bucket',
    });

    await expect(
      service.rollbackRemediation({
        actionId: 'act_1',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow(/No remediator SA bound/);
  });

  it('execute records the refined (executed) plan hash in the audit trail', async () => {
    const refinedFix = {
      ...STORAGE_FIX,
      body: { iamConfiguration: { uniformBucketLevelAccess: true } },
    };
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    // Refine changes the steps after the initial plan was generated.
    aiRemediationService.refineGcpFixPlan.mockResolvedValue({
      canAutoFix: true,
      fixSteps: [refinedFix],
      readSteps: [STORAGE_READ],
      rollbackSteps: [],
      currentState: {},
      proposedState: {},
      description: 'refined fix',
      risk: 'low',
      rollbackSupported: false,
    });
    mockFinding(storageFinding());

    const result = await service.executeRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
    });

    expect(result.status).toBe('unverified');
    // Same honest outcome as above: the mock proves execution, not effect.
    const appliedState = (
      mockDb.remediationAction.update.mock.calls[0]?.[0] as {
        data: { appliedState: { fixIdentity: { planHash: string } } };
      }
    ).data.appliedState;
    expect(appliedState.fixIdentity.planHash).toBe(
      hashGcpPlanSteps([refinedFix]),
    );
    expect(appliedState.fixIdentity.planHash).not.toBe(
      hashGcpPlanSteps([STORAGE_FIX]),
    );
  });

  it('rollback uses the stored identity when the finding cannot re-resolve', async () => {
    const { service, impersonationService } = makeService({
      // No pair map stored: re-resolution from the finding would fail.
      vaultCreds: { access_token: 'auditor-token' },
    });
    mockDb.remediationAction.findFirst.mockResolvedValue({
      id: 'act_1',
      status: 'success',
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      appliedState: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            purpose: 'rollback',
          },
        ],
        fixIdentity: {
          saEmail: SA,
          assetClass: 'Storage',
          tokenTtlSeconds: 600,
          planHash: 'gcp-abc',
        },
      },
      remediationKey: 'fix',
      // No projects/<id> segment and no evidence: re-resolution yields no SA.
      resourceId: 'my-bucket',
      resourceType: 'gcp-storage-bucket',
    });

    const result = await service.rollbackRemediation({
      actionId: 'act_1',
      organizationId: 'org_1',
    });

    expect(result.status).toBe('rolled_back');
    expect(impersonationService.mintRemediatorToken).toHaveBeenCalledWith(
      expect.objectContaining({ saEmail: SA }),
    );
  });
});
