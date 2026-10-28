import type { CloudSecurityService } from './cloud-security.service';
import type { GCPSecurityService } from './providers/gcp-security.service';
import {
  readProjectIds,
  resolveGcpSetupContext,
  withGcpResolveActions,
} from './gcp-setup.helpers';

type CloudSecurityMock = {
  getConnectionForDetect: jest.Mock;
  saveConnectionVariable: jest.Mock;
};

type GcpSecurityMock = {
  detectOrganizations: jest.Mock;
  detectProjectsForOrg: jest.Mock;
  detectProjects: jest.Mock;
};

const PROJECT = { id: 'prj-1', name: 'Payments', number: '123' };

function makeMocks(variables: Record<string, unknown>) {
  const cloudSecurityService: CloudSecurityMock = {
    getConnectionForDetect: jest.fn().mockResolvedValue({
      credentials: { access_token: 'token' },
      variables,
    }),
    saveConnectionVariable: jest.fn().mockResolvedValue(undefined),
  };
  const gcpSecurityService: GcpSecurityMock = {
    detectOrganizations: jest.fn().mockResolvedValue([]),
    detectProjectsForOrg: jest.fn().mockResolvedValue([PROJECT]),
    detectProjects: jest.fn().mockResolvedValue([PROJECT]),
  };
  return {
    cloudSecurityService:
      cloudSecurityService as unknown as CloudSecurityService,
    gcpSecurityService: gcpSecurityService as unknown as GCPSecurityService,
    mocks: { cloudSecurityService, gcpSecurityService },
  };
}

describe('resolveGcpSetupContext organization pinning', () => {
  it('uses a saved organization_id without re-detecting organizations', async () => {
    const { cloudSecurityService, gcpSecurityService, mocks } = makeMocks({
      organization_id: 'org_saved',
    });

    const context = await resolveGcpSetupContext(
      cloudSecurityService,
      gcpSecurityService,
      'conn_1',
      'org_1',
    );

    expect(context.organizationId).toBe('org_saved');
    expect(mocks.gcpSecurityService.detectOrganizations).not.toHaveBeenCalled();
    expect(mocks.gcpSecurityService.detectProjectsForOrg).toHaveBeenCalledWith(
      'token',
      'org_saved',
    );
    expect(
      mocks.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
  });

  it('auto-saves when exactly one organization is detected (mirrors detect-gcp-org)', async () => {
    const { cloudSecurityService, gcpSecurityService, mocks } = makeMocks({});
    mocks.gcpSecurityService.detectOrganizations.mockResolvedValue([
      { id: 'org_only', displayName: 'Only Org' },
    ]);

    const context = await resolveGcpSetupContext(
      cloudSecurityService,
      gcpSecurityService,
      'conn_1',
      'org_1',
    );

    expect(context.organizationId).toBe('org_only');
    expect(
      mocks.cloudSecurityService.saveConnectionVariable,
    ).toHaveBeenCalledWith('conn_1', 'organization_id', 'org_only', 'org_1');
    expect(mocks.gcpSecurityService.detectProjectsForOrg).toHaveBeenCalledWith(
      'token',
      'org_only',
    );
  });

  it('refuses to pin an arbitrary organization when several are detected', async () => {
    const { cloudSecurityService, gcpSecurityService, mocks } = makeMocks({});
    mocks.gcpSecurityService.detectOrganizations.mockResolvedValue([
      { id: 'org_a', displayName: 'A' },
      { id: 'org_b', displayName: 'B' },
    ]);

    await expect(
      resolveGcpSetupContext(
        cloudSecurityService,
        gcpSecurityService,
        'conn_1',
        'org_1',
      ),
    ).rejects.toThrow(/Multiple GCP organizations/);

    // Nothing persisted, nothing scoped to an arbitrary org.
    expect(
      mocks.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
    expect(
      mocks.gcpSecurityService.detectProjectsForOrg,
    ).not.toHaveBeenCalled();
  });

  it('skips pinning and falls back to all projects when no organization exists', async () => {
    const { cloudSecurityService, gcpSecurityService, mocks } = makeMocks({});

    const context = await resolveGcpSetupContext(
      cloudSecurityService,
      gcpSecurityService,
      'conn_1',
      'org_1',
    );

    expect(context.organizationId).toBeUndefined();
    expect(
      mocks.cloudSecurityService.saveConnectionVariable,
    ).not.toHaveBeenCalled();
    expect(mocks.gcpSecurityService.detectProjects).toHaveBeenCalledWith(
      'token',
    );
    expect(context.projectId).toBe('prj-1');
  });

  it('prefers an explicit projectId override for API enablement', async () => {
    const { cloudSecurityService, gcpSecurityService } = makeMocks({
      organization_id: 'org_saved',
    });

    const context = await resolveGcpSetupContext(
      cloudSecurityService,
      gcpSecurityService,
      'conn_1',
      'org_1',
      'prj_override',
    );

    expect(context.projectId).toBe('prj_override');
  });

  it('throws an actionable error when there is no access token', async () => {
    const { cloudSecurityService, gcpSecurityService, mocks } = makeMocks({});
    mocks.cloudSecurityService.getConnectionForDetect.mockResolvedValue({
      credentials: {},
      variables: {},
    });

    await expect(
      resolveGcpSetupContext(
        cloudSecurityService,
        gcpSecurityService,
        'conn_1',
        'org_1',
      ),
    ).rejects.toThrow(/No access token found/);
  });
});

describe('readProjectIds', () => {
  it('returns string ids from a well-formed project_ids array', () => {
    expect(readProjectIds({ project_ids: ['prj-1', 'prj-2'] })).toEqual([
      'prj-1',
      'prj-2',
    ]);
  });

  it('drops non-string junk from persisted project_ids (legacy writes)', () => {
    expect(
      readProjectIds({
        project_ids: ['prj-1', 123, null, undefined, {}, ['prj-2'], 'prj-3'],
      }),
    ).toEqual(['prj-1', 'prj-3']);
  });

  it('returns [] when project_ids is missing or not an array', () => {
    expect(readProjectIds({})).toEqual([]);
    expect(readProjectIds({ project_ids: 'prj-1' })).toEqual([]);
    expect(readProjectIds({ project_ids: null })).toEqual([]);
    expect(readProjectIds({ project_ids: 42 })).toEqual([]);
  });
});

describe('withGcpResolveActions', () => {
  const failed = {
    id: 'enable_service_usage_api',
    success: false,
  } as unknown as Parameters<typeof withGcpResolveActions>[0][number];
  const passed = {
    id: 'grant_findings_viewer_role',
    success: true,
  } as unknown as Parameters<typeof withGcpResolveActions>[0][number];

  it('adds a connection-scoped resolve action to failed steps', () => {
    const [step] = withGcpResolveActions([failed], 'conn_1');
    expect(step.resolveAction).toEqual({
      label: 'Resolve this',
      method: 'POST',
      endpoint: '/v1/cloud-security/setup-gcp/conn_1/resolve-step',
      body: { stepId: 'enable_service_usage_api' },
    });
  });

  it('leaves successful steps untouched', () => {
    const [step] = withGcpResolveActions([passed], 'conn_1');
    expect(step.resolveAction).toBeUndefined();
  });
});
