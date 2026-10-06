import { db } from '@db';
import { GcpImpersonationService } from './gcp-impersonation.service';
import {
  GcpRemediationService,
  appliedFixStepsForOverlap,
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

// Mirrors executeParams identifiers below: the service hashes the same
// binding from its own params, so spec hashes must use these values.
const BINDING = {
  organizationId: 'org_1',
  connectionId: 'conn_gcp',
  checkResultId: 'chk_1',
  remediationKey: 'fix',
};

function storageFinding() {
  return {
    id: 'chk_1',
    title: 'Bucket is public',
    description: 'desc',
    severity: 'high',
    resourceId: 'projects/my-proj-123/buckets/my-bucket',
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
        expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
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
        expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
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
      expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
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
      expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
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
      // Preview returned (and cached) the refined plan: both the
      // generated and refined plans carry it, so the acknowledged hash
      // matches at the pre-check and the post-refine check.
      aiPlan: { fixSteps: [refinedFix] },
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
      expectedPlanHash: hashGcpPlanSteps([refinedFix], [], BINDING),
    });

    expect(result.status).toBe('unverified');
    // Same honest outcome as above: the mock proves execution, not effect.
    const appliedState = (
      mockDb.remediationAction.update.mock.calls[0]?.[0] as {
        data: { appliedState: { fixIdentity: { planHash: string } } };
      }
    ).data.appliedState;
    expect(appliedState.fixIdentity.planHash).toBe(
      hashGcpPlanSteps([refinedFix], [], BINDING),
    );
    expect(appliedState.fixIdentity.planHash).not.toBe(
      hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
    );
  });

  it('execute records the refined plan hash when the run fails after refinement', async () => {
    const refinedFix = {
      ...STORAGE_FIX,
      body: { iamConfiguration: { uniformBucketLevelAccess: true } },
    };
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan: { fixSteps: [refinedFix] },
    });
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
    // Reads succeed; the fix execution itself throws.
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ method: string }> }) => {
        if (steps.some((step) => step.method !== 'GET')) {
          throw new Error('fix execution exploded');
        }
        return {
          results: steps.map((step) => ({ step, output: { ok: true } })),
        };
      },
    );

    const result = await service.executeRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
      expectedPlanHash: hashGcpPlanSteps([refinedFix], [], BINDING),
    });

    expect(result.status).toBe('failed');
    // The failure row must bind the forensic hash to the refined steps
    // that ran — not the cached plan they were refined from.
    const failedCall = mockDb.remediationAction.update.mock.calls.find(
      (call: Array<{ data?: { status?: string } }>) =>
        call[0]?.data?.status === 'failed',
    );
    const appliedState = (
      failedCall?.[0] as unknown as {
        data: { appliedState: { fixIdentity: { planHash: string } } };
      }
    ).data.appliedState;
    expect(appliedState.fixIdentity.planHash).toBe(
      hashGcpPlanSteps([refinedFix], [], BINDING),
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
      previousState: { read: { iamConfiguration: {} } },
      appliedState: {
        steps: [
          {
            command:
              'PATCH https://storage.googleapis.com/storage/v1/b/my-bucket',
            purpose: 'fix',
          },
        ],
        rollbackSteps: [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            queryParams: { updateMask: 'iamConfiguration' },
            purpose: 'rollback',
          },
        ],
        readSteps: [
          {
            purpose: 'read',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
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
      // Slashed id binds bucket + project; no vault map means SA
      // re-resolution still yields no SA, so the stored identity is used.
      resourceId: 'projects/my-proj-123/buckets/my-bucket',
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

describe('GcpRemediationService preview enforcement', () => {
  const COMPUTE_FIX = {
    method: 'PATCH' as const,
    url: 'https://compute.googleapis.com/compute/v1/projects/my-proj-123/zones/z/instances/i',
    body: { metadata: {} },
    purpose: 'cross-class fix',
  };

  function previewParams() {
    return {
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    };
  }

  it('threads the asset class into plan generation and refinement', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    await service.previewRemediation(previewParams());

    expect(aiRemediationService.generateGcpFixPlan).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'gcp-storage-bucket' }),
      { assetClass: 'Storage' },
    );
    expect(aiRemediationService.refineGcpFixPlan).toHaveBeenCalledWith(
      expect.objectContaining({ assetClass: 'Storage' }),
    );
  });

  it('returns guided-only without caching when fix steps fail the allowlist', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan: { fixSteps: [COMPUTE_FIX] },
    });
    mockFinding(storageFinding());

    const first = await service.previewRemediation(previewParams());
    expect(first.guidedOnly).toBe(true);
    expect(
      ((first as Record<string, unknown>).guidedSteps as string[])
        .join(' ')
        .toLowerCase(),
    ).toContain('not allowlisted');

    // Nothing cached: a second preview regenerates instead of replaying.
    await service.previewRemediation(previewParams());
    expect(aiRemediationService.generateGcpFixPlan).toHaveBeenCalledTimes(2);
  });

  it('returns guided-only when parameter guardrails reject the fix', async () => {
    const sqlFinding = {
      ...storageFinding(),
      resourceType: 'gcp-cloud-sql-instance',
      resourceId: 'projects/my-proj-123/instances/my-sql',
    };
    const sqlMap = JSON.stringify({
      'Data:my-proj-123':
        'opencomp-remediator@my-proj-123.iam.gserviceaccount.com',
    });
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: sqlMap },
      aiPlan: {
        fixSteps: [
          {
            method: 'PATCH',
            url: 'https://sqladmin.googleapis.com/v1/projects/my-proj-123/instances/my-sql',
            body: {
              settings: { ipConfiguration: { ipv4Enabled: false } },
            },
            purpose: 'remove public IP',
          },
        ],
      },
    });
    mockFinding(sqlFinding);

    const result = await service.previewRemediation(previewParams());
    expect(result.guidedOnly).toBe(true);
    expect(
      ((result as Record<string, unknown>).guidedSteps as string[]).join(' '),
    ).toMatch(/breaks connectivity/);
  });

  it('drops invalid auto-rollback steps instead of executing them', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan: {
        rollbackSteps: [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            purpose: 'rollback without updateMask',
          },
        ],
      },
    });
    mockFinding(storageFinding());

    const result = await service.executeRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
      expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
    });

    // The fix itself proceeds; only the unvalidated rollback is removed.
    expect(result.status).toBe('unverified');
    const fixCall = mockExecute.mock.calls.find(
      (c) => 'autoRollbackSteps' in c[0],
    );
    expect(fixCall?.[0].autoRollbackSteps).toEqual([]);
    const stored = (
      mockDb.remediationAction.update.mock.calls[0]?.[0] as {
        data: { appliedState: { rollbackSteps: unknown[] } };
      }
    ).data.appliedState;
    expect(stored.rollbackSteps).toEqual([]);
  });

  it('preview reports rollbackUnsupported when the rollback does not validate', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan: {
        rollbackSupported: true,
        rollbackSteps: [
          {
            method: 'PATCH',
            url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
            body: { iamConfiguration: {} },
            purpose: 'rollback without updateMask',
          },
        ],
      },
    });
    mockFinding(storageFinding());

    const result = await service.previewRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    });

    // The fix itself previews fine — but the UI must not promise a
    // rollback that execute would drop.
    expect(result.guidedOnly).toBe(false);
    expect(result.rollbackSupported).toBe(false);
  });

  it('preview falls back (and warns) when reads fail instead of throwing', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    mockExecute.mockRejectedValueOnce(new Error('GCP read boom'));

    const result = await service.previewRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    });

    // Ungrounded initial plan: usable without state, so it still previews —
    // the fail-closed validators push state-needing plans to guided-only.
    expect(result.guidedOnly).toBe(false);
    expect(result.apiCalls).toHaveLength(1);
  });

  it('preview checks advertised rollbacks against the same live state', async () => {
    const rollback = {
      method: 'PATCH' as const,
      url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      body: { iamConfiguration: {} },
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'restore bucket',
    };
    const aiPlan = {
      rollbackSupported: true,
      rollbackSteps: [rollback],
    };
    const params = {
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    };

    // Reads return the pre-fix value the rollback claims to restore.
    const { service: matching } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan,
    });
    mockFinding(storageFinding());
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ purpose: string }> }) => ({
        results: steps.map((step) => ({
          step,
          output:
            step.purpose === 'read bucket' ? { iamConfiguration: {} } : {},
        })),
      }),
    );
    const ok = await matching.previewRemediation(params);
    expect(ok.guidedOnly).toBe(false);
    expect(ok.rollbackSupported).toBe(true);

    // Reads return unrelated state: the rollback is unverifiable, so the
    // preview must not advertise it — same verdict execute would reach.
    const { service: missing } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan,
    });
    mockFinding(storageFinding());
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ purpose: string }> }) => ({
        results: steps.map((step) => ({ step, output: { ok: true } })),
      }),
    );
    const dropped = await missing.previewRemediation(params);
    expect(dropped.guidedOnly).toBe(false);
    expect(dropped.rollbackSupported).toBe(false);
  });
});

describe('appliedFixStepsForOverlap', () => {
  it('reconstructs method and URL from command strings', () => {
    expect(
      appliedFixStepsForOverlap({
        steps: [
          {
            command: 'PATCH https://storage.googleapis.com/storage/v1/b/b',
            purpose: 'fix',
          },
        ],
      }),
    ).toEqual([
      {
        method: 'PATCH',
        url: 'https://storage.googleapis.com/storage/v1/b/b',
        purpose: 'fix',
      },
    ]);
  });

  it('drops unparseable entries (stricter overlap, never looser)', () => {
    expect(
      appliedFixStepsForOverlap({
        steps: [
          { command: 'PATCH', purpose: 'no url' },
          { command: 42, purpose: 'not a string' },
          null,
          {
            command: 'POST https://example.googleapis.com/v1/x',
            purpose: 'ok',
          },
        ],
      }),
    ).toEqual([
      {
        method: 'POST',
        url: 'https://example.googleapis.com/v1/x',
        purpose: 'ok',
      },
    ]);
  });

  it('returns empty for missing or non-array steps', () => {
    expect(appliedFixStepsForOverlap({})).toEqual([]);
    expect(appliedFixStepsForOverlap({ steps: 'nope' })).toEqual([]);
  });

  it('rehydrates persisted query identity into queryParams', () => {
    expect(
      appliedFixStepsForOverlap({
        steps: [
          {
            command:
              'PUT https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
            purpose: 'fix',
            queryIdentity: ['alice'],
          },
        ],
      }),
    ).toEqual([
      {
        method: 'PUT',
        url: 'https://sqladmin.googleapis.com/v1/projects/p/instances/i/users',
        purpose: 'fix',
        queryParams: { name: ['alice'] },
      },
    ]);
  });

  it('ignores malformed query identity (overlap fails closed)', () => {
    expect(
      appliedFixStepsForOverlap({
        steps: [
          {
            command: 'PUT https://example.googleapis.com/v1/x',
            purpose: 'a',
            queryIdentity: 'alice',
          },
          {
            command: 'PUT https://example.googleapis.com/v1/y',
            purpose: 'b',
            queryIdentity: [42, ''],
          },
          {
            command: 'PUT https://example.googleapis.com/v1/z',
            purpose: 'c',
            queryIdentity: [],
          },
        ],
      }),
    ).toEqual([
      {
        method: 'PUT',
        url: 'https://example.googleapis.com/v1/x',
        purpose: 'a',
      },
      {
        method: 'PUT',
        url: 'https://example.googleapis.com/v1/y',
        purpose: 'b',
      },
      {
        method: 'PUT',
        url: 'https://example.googleapis.com/v1/z',
        purpose: 'c',
      },
    ]);
  });
});

describe('review fixes: acknowledgment binding and verification', () => {
  function executeParams(extra?: Record<string, unknown>) {
    return {
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
      userId: 'user_1',
      acknowledgment: 'acknowledged',
      ...(extra ?? {}),
    };
  }

  it('execute refuses without acknowledgment', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    await expect(
      service.executeRemediation({
        connectionId: 'conn_gcp',
        organizationId: 'org_1',
        checkResultId: 'chk_1',
        remediationKey: 'fix',
        userId: 'user_1',
      }),
    ).rejects.toThrow(/Acknowledgment is required/);
  });

  it('execute refuses when the plan changed since acknowledgment', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    await expect(
      service.executeRemediation(
        executeParams({ expectedPlanHash: 'gcp-stalehash' }),
      ),
    ).rejects.toThrow(/changed since you acknowledged/);
  });

  it('execute accepts a matching expectedPlanHash', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    const expected = hashGcpPlanSteps([STORAGE_FIX], [], BINDING);

    const result = await service.executeRemediation(
      executeParams({ expectedPlanHash: expected }),
    );
    expect(['success', 'unverified']).toContain(result.status);
  });

  it('execute accepts the preview hash when the validated rollback is non-empty', async () => {
    // Regression: the pre-refinement acknowledgment check hashed fix
    // steps alone while the preview hash covers fix plus validated
    // rollback, so execute refused its own preview on every plan with a
    // safety net. The check must cover the cached (validated) rollback.
    const rollback = {
      method: 'PATCH' as const,
      url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      body: { iamConfiguration: {} },
      queryParams: { updateMask: 'iamConfiguration' },
      purpose: 'restore bucket',
    };
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
      aiPlan: { rollbackSupported: true, rollbackSteps: [rollback] },
    });
    mockFinding(storageFinding());
    // Reads return the pre-fix value the rollback claims to restore, so
    // the validated rollback set is non-empty in preview and in execute.
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ purpose: string }> }) => ({
        results: steps.map((step) => ({
          step,
          output:
            step.purpose === 'read bucket' ? { iamConfiguration: {} } : {},
        })),
      }),
    );

    const preview = (await service.previewRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    })) as unknown as {
      guidedOnly: boolean;
      rollbackSupported: boolean;
      planHash: string;
    };
    expect(preview.guidedOnly).toBe(false);
    expect(preview.rollbackSupported).toBe(true);

    const result = await service.executeRemediation(
      executeParams({ expectedPlanHash: preview.planHash }),
    );
    expect(['success', 'unverified']).toContain(result.status);
  });

  it('execute refuses when refinement rewrites the acknowledged plan', async () => {
    // The pre-refinement check passes for the cached plan, but the
    // refined steps differ — the acknowledged hash must cover what runs.
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    const acknowledged = hashGcpPlanSteps([STORAGE_FIX], [], BINDING);
    aiRemediationService.refineGcpFixPlan.mockResolvedValue({
      canAutoFix: true,
      fixSteps: [
        {
          ...STORAGE_FIX,
          body: {
            iamConfiguration: { publicAccessPrevention: 'enforced' },
          },
        },
      ],
      readSteps: [STORAGE_READ],
      rollbackSteps: [],
      currentState: {},
      proposedState: {},
      description: 'refined fix',
      risk: 'low',
      rollbackSupported: false,
    });

    await expect(
      service.executeRemediation(
        executeParams({ expectedPlanHash: acknowledged }),
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/changed since you acknowledged/),
    });
    // Phase 1 reads still run (read-only, auditor token) — but no fix
    // step may execute under a stale acknowledgment.
    const fixCalls = mockExecute.mock.calls.filter(
      (call) => !(call[0] as { isRead?: boolean }).isRead,
    );
    expect(fixCalls).toEqual([]);
  });

  it('execute stays unverified when refinement renames read purposes', async () => {
    const renamedRead = {
      method: 'GET' as const,
      url: 'https://storage.googleapis.com/storage/v1/b/my-bucket',
      purpose: 'read bucket v2',
    };
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    // Refine swaps the read purpose: pre-fix state is keyed 'read bucket',
    // the re-read is keyed 'read bucket v2'. Comparing the raw maps would
    // always differ and report a false success.
    aiRemediationService.refineGcpFixPlan.mockImplementation(
      async ({ originalPlan }: { originalPlan: Record<string, unknown> }) => ({
        ...(originalPlan as object),
        readSteps: [renamedRead],
      }),
    );
    mockFinding(storageFinding());
    mockExecute.mockImplementation(
      async ({ steps }: { steps: Array<{ purpose: string }> }) => ({
        results: steps.map((step) => ({
          step,
          output: { iamConfiguration: { uniform: true } },
        })),
      }),
    );

    const result = await service.executeRemediation(
      executeParams({
        expectedPlanHash: hashGcpPlanSteps([STORAGE_FIX], [], BINDING),
      }),
    );
    expect(result.status).toBe('unverified');
  });

  it('execute refuses without the previewed plan hash', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    await expect(service.executeRemediation(executeParams())).rejects.toThrow(
      /requires the previewed plan hash/,
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('self-healing refuses a recovery plan that changes acknowledged targets', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    const acknowledged = hashGcpPlanSteps([STORAGE_FIX], [], BINDING);
    // Phase-2 refine keeps the acknowledged plan; the self-heal refine
    // after a runtime failure renames the target bucket. Bucket binding
    // refuses it fail-closed before the acknowledged-target pin is reached.
    aiRemediationService.refineGcpFixPlan
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [STORAGE_FIX],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'refined fix',
        risk: 'low',
        rollbackSupported: false,
      })
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [
          {
            ...STORAGE_FIX,
            url: 'https://storage.googleapis.com/storage/v1/b/other-bucket',
          },
        ],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'regenerated fix',
        risk: 'low',
        rollbackSupported: false,
      });
    mockExecute.mockImplementation(
      async ({ steps, isRead }: { steps: unknown[]; isRead?: boolean }) => {
        if (isRead) {
          return {
            results: steps.map((step) => ({
              step,
              output: { iamConfiguration: {} },
            })),
          };
        }
        return {
          results: [],
          error: { message: 'InternalError: boom', step: STORAGE_FIX },
        };
      },
    );

    const result = await service.executeRemediation(
      executeParams({ expectedPlanHash: acknowledged }),
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/cross-bucket/),
    });
    // The retargeted plan never executed: only reads + first attempt ran.
    const fixCalls = mockExecute.mock.calls.filter(
      (call) => !(call[0] as { isRead?: boolean }).isRead,
    );
    expect(fixCalls).toHaveLength(1);
  });

  it('self-healing retries when the recovery keeps the acknowledged plan', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    const acknowledged = hashGcpPlanSteps([STORAGE_FIX], [], BINDING);
    aiRemediationService.refineGcpFixPlan
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [STORAGE_FIX],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'refined fix',
        risk: 'low',
        rollbackSupported: false,
      })
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [STORAGE_FIX],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'regenerated fix',
        risk: 'low',
        rollbackSupported: false,
      });
    const seenFixBodies: unknown[] = [];
    let fixCalls = 0;
    mockExecute.mockImplementation(
      async ({ steps, isRead }: { steps: unknown[]; isRead?: boolean }) => {
        if (isRead) {
          return {
            results: steps.map((step) => ({
              step,
              output: { iamConfiguration: {} },
            })),
          };
        }
        seenFixBodies.push((steps[0] as { body?: unknown })?.body);
        fixCalls += 1;
        if (fixCalls === 1) {
          return {
            results: [],
            error: { message: 'InternalError: boom', step: STORAGE_FIX },
          };
        }
        return {
          results: steps.map((step) => ({ step, output: { ok: true } })),
        };
      },
    );

    await service.executeRemediation(
      executeParams({ expectedPlanHash: acknowledged }),
    );
    // The unchanged recovery ran: same targets and same hash as acknowledged.
    expect(seenFixBodies).toEqual([STORAGE_FIX.body, STORAGE_FIX.body]);
  });

  it('refuses recovery that rewrites params outside the acknowledgment', async () => {
    const { service, aiRemediationService } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());
    const acknowledged = hashGcpPlanSteps([STORAGE_FIX], [], BINDING);
    const repairedStep = {
      ...STORAGE_FIX,
      body: { iamConfiguration: { publicAccessPrevention: 'enforced' } },
    };
    aiRemediationService.refineGcpFixPlan
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [STORAGE_FIX],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'refined fix',
        risk: 'low',
        rollbackSupported: false,
      })
      .mockResolvedValueOnce({
        canAutoFix: true,
        fixSteps: [repairedStep],
        readSteps: [STORAGE_READ],
        rollbackSteps: [],
        currentState: {},
        proposedState: {},
        description: 'regenerated fix',
        risk: 'low',
        rollbackSupported: false,
      });
    let fixCalls = 0;
    mockExecute.mockImplementation(
      async ({ steps, isRead }: { steps: unknown[]; isRead?: boolean }) => {
        if (isRead) {
          return {
            results: steps.map((step) => ({
              step,
              output: { iamConfiguration: {} },
            })),
          };
        }
        fixCalls += 1;
        if (fixCalls === 1) {
          return {
            results: [],
            error: { message: 'InternalError: boom', step: STORAGE_FIX },
          };
        }
        return {
          results: steps.map((step) => ({ step, output: { ok: true } })),
        };
      },
    );

    const result = (await service.executeRemediation(
      executeParams({ expectedPlanHash: acknowledged }),
    )) as Record<string, unknown>;
    // The param-changed recovery never ran: the run fails closed with a
    // re-preview message instead of executing unacknowledged params.
    expect(result.status).toBe('failed');
    expect(String(result.error)).toMatch(/regenerated recovery plan differs/);
    expect(fixCalls).toBe(1);
  });

  it('preview advertises the plan hash for acknowledgment binding', async () => {
    const { service } = makeService({
      vaultCreds: { access_token: 'auditor-token', gcpRemediation: MAP },
    });
    mockFinding(storageFinding());

    const preview = (await service.previewRemediation({
      connectionId: 'conn_gcp',
      organizationId: 'org_1',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    })) as Record<string, unknown>;
    expect(preview.planHash).toBe(hashGcpPlanSteps([STORAGE_FIX], [], BINDING));
  });
});

describe('GcpRemediationService plan cache', () => {
  interface CacheProbe {
    planCacheKey(params: {
      organizationId: string;
      connectionId: string;
      checkResultId: string;
      remediationKey: string;
    }): string;
    planCache: Map<string, { plan: unknown; timestamp: number }>;
    evictStalePlans(): void;
  }

  function probe(service: GcpRemediationService): CacheProbe {
    return service as unknown as CacheProbe;
  }

  function cacheEntry(ageMs: number): { plan: unknown; timestamp: number } {
    return { plan: { canAutoFix: true }, timestamp: Date.now() - ageMs };
  }

  it('scopes cache keys by organization', () => {
    const { service } = makeService({});
    const base = {
      connectionId: 'conn_gcp',
      checkResultId: 'chk_1',
      remediationKey: 'fix',
    };
    const a = probe(service).planCacheKey({
      ...base,
      organizationId: 'org_1',
    });
    const b = probe(service).planCacheKey({
      ...base,
      organizationId: 'org_2',
    });
    expect(a).not.toBe(b);
    expect(a.startsWith('org_1:')).toBe(true);
    expect(b.startsWith('org_2:')).toBe(true);
  });

  it('evicts expired entries even below capacity', () => {
    const { service } = makeService({});
    const store = probe(service);
    store.planCache.set('org_1:c:k:r', cacheEntry(10 * 60 * 1000));
    store.planCache.set('org_1:c:k:r2', cacheEntry(0));
    store.evictStalePlans();
    expect(store.planCache.has('org_1:c:k:r')).toBe(false);
    expect(store.planCache.has('org_1:c:k:r2')).toBe(true);
  });

  it('trims oldest entries past capacity', () => {
    const { service } = makeService({});
    const store = probe(service);
    for (let i = 0; i < 101; i++) {
      store.planCache.set(`org_1:c:k:r${i}`, cacheEntry(0));
    }
    store.evictStalePlans();
    expect(store.planCache.size).toBeLessThanOrEqual(100);
    expect(store.planCache.has('org_1:c:k:r0')).toBe(false);
  });
});
