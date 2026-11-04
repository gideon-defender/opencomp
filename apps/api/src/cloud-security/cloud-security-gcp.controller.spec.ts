// Same import-time stubs as cloud-security.controller.spec.ts — the guards
// and transitive imports must not boot Prisma/better-auth in unit tests.
jest.mock('@db', () => ({ db: {} }));
jest.mock('@gideon-defender/auth', () => ({
  statement: {},
  ac: { newRole: () => ({}) },
}));
jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';

import { CloudSecurityGcpController } from './cloud-security-gcp.controller';
import {
  CloudSecurityService,
  ConnectionNotFoundError,
  ConcurrentVariableSaveError,
} from './cloud-security.service';
import { GCPSecurityService } from './providers/gcp-security.service';
import { SelectGcpProjectsDto } from './dto/select-gcp-projects.dto';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';

/**
 * selectGcpProjects maps the service's domain errors onto HTTP semantics:
 * unknown/cross-tenant connection → 404, optimistic-concurrency conflict
 * that outlasts the retries → 409 with a retryable signal (never a bare 500).
 */
describe('CloudSecurityGcpController — selectGcpProjects', () => {
  let controller: CloudSecurityGcpController;
  let cloudSecurityService: { saveConnectionVariables: jest.Mock };

  beforeEach(async () => {
    cloudSecurityService = { saveConnectionVariables: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudSecurityGcpController],
      providers: [
        { provide: CloudSecurityService, useValue: cloudSecurityService },
        { provide: GCPSecurityService, useValue: {} },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CloudSecurityGcpController);
    jest.clearAllMocks();
  });

  function body(): SelectGcpProjectsDto {
    return {
      projectIds: ['prj-1', 'prj-2'],
      gcpOrganizationId: 'org_gcp',
      projectNames: { 'prj-1': 'Payments' },
    };
  }

  it('forwards one merged write and returns the selection on success', async () => {
    cloudSecurityService.saveConnectionVariables.mockResolvedValueOnce(
      undefined,
    );

    const result = await controller.selectGcpProjects(
      'conn_1',
      body(),
      'org_1',
    );

    expect(cloudSecurityService.saveConnectionVariables).toHaveBeenCalledWith(
      'conn_1',
      {
        project_ids: ['prj-1', 'prj-2'],
        organization_id: 'org_gcp',
        project_names: { 'prj-1': 'Payments' },
      },
      'org_1',
    );
    expect(result).toEqual({ projectIds: ['prj-1', 'prj-2'] });
  });

  it('maps ConnectionNotFoundError to a 404', async () => {
    cloudSecurityService.saveConnectionVariables.mockRejectedValueOnce(
      new ConnectionNotFoundError(),
    );

    const error = await controller
      .selectGcpProjects('conn_missing', body(), 'org_1')
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
  });

  it('maps ConcurrentVariableSaveError to a retryable 409', async () => {
    cloudSecurityService.saveConnectionVariables.mockRejectedValueOnce(
      new ConcurrentVariableSaveError(),
    );

    const error = await controller
      .selectGcpProjects('conn_1', body(), 'org_1')
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it('rethrows unexpected errors instead of masking them as 4xx', async () => {
    const boom = new Error('database is on fire');
    cloudSecurityService.saveConnectionVariables.mockRejectedValueOnce(boom);

    await expect(
      controller.selectGcpProjects('conn_1', body(), 'org_1'),
    ).rejects.toBe(boom);
  });
});

describe('CloudSecurityGcpController — detectGcpOrg', () => {
  let controller: CloudSecurityGcpController;
  let services: {
    getConnectionForDetect: jest.Mock;
    saveConnectionVariable: jest.Mock;
  };
  let gcp: {
    detectOrganizations: jest.Mock;
    detectProjectsForOrg: jest.Mock;
  };

  beforeEach(async () => {
    services = {
      getConnectionForDetect: jest.fn().mockResolvedValue({
        credentials: { access_token: 'token' },
        variables: {},
      }),
      saveConnectionVariable: jest.fn().mockResolvedValue(undefined),
    };
    gcp = {
      detectOrganizations: jest.fn().mockResolvedValue([]),
      detectProjectsForOrg: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudSecurityGcpController],
      providers: [
        { provide: CloudSecurityService, useValue: services },
        { provide: GCPSecurityService, useValue: gcp },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CloudSecurityGcpController);
    jest.clearAllMocks();
  });

  it('auto-saves the organization when exactly one is detected', async () => {
    gcp.detectOrganizations.mockResolvedValueOnce([
      { id: 'org_only', displayName: 'Only' },
    ]);

    const result = await controller.detectGcpOrg('conn_1', 'org_1');

    expect(result.selectedOrganizationId).toBe('org_only');
    expect(services.saveConnectionVariable).toHaveBeenCalledWith(
      'conn_1',
      'organization_id',
      'org_only',
      'org_1',
    );
  });

  it('does not auto-save when several organizations are detected', async () => {
    gcp.detectOrganizations.mockResolvedValueOnce([
      { id: 'org_a', displayName: 'A' },
      { id: 'org_b', displayName: 'B' },
    ]);

    const result = await controller.detectGcpOrg('conn_1', 'org_1');

    expect(services.saveConnectionVariable).not.toHaveBeenCalled();
    expect(result.selectedOrganizationId).toBeUndefined();
  });

  it('returns a 400 when the connection has no access token', async () => {
    services.getConnectionForDetect.mockResolvedValueOnce({
      credentials: {},
      variables: {},
    });

    const error = await controller
      .detectGcpOrg('conn_1', 'org_1')
      .catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('sorts projects by name and returns only explicitly selected ids', async () => {
    gcp.detectOrganizations.mockResolvedValueOnce([
      { id: 'org_only', displayName: 'Only' },
    ]);
    gcp.detectProjectsForOrg.mockResolvedValueOnce([
      { id: 'prj_b', name: 'Bravo', number: '2' },
      { id: 'prj_a', name: 'Alpha', number: '1' },
    ]);
    services.getConnectionForDetect.mockResolvedValueOnce({
      credentials: { access_token: 'token' },
      variables: { project_ids: ['prj_b', 123, 'prj_a'] },
    });

    const result = await controller.detectGcpOrg('conn_1', 'org_1');

    expect(result.organizations[0].projects.map((p) => p.name)).toEqual([
      'Alpha',
      'Bravo',
    ]);
    expect(result.selectedProjectIds).toEqual(['prj_b', 'prj_a']);
  });
});

describe('CloudSecurityGcpController — setupGcp / resolveGcpSetupStep', () => {
  let controller: CloudSecurityGcpController;
  let services: {
    getConnectionForDetect: jest.Mock;
    saveConnectionVariable: jest.Mock;
  };
  let gcp: {
    detectOrganizations: jest.Mock;
    detectProjectsForOrg: jest.Mock;
    detectProjects: jest.Mock;
    autoSetup: jest.Mock;
    resolveSetupStep: jest.Mock;
  };

  beforeEach(async () => {
    services = {
      getConnectionForDetect: jest.fn().mockResolvedValue({
        credentials: { access_token: 'token' },
        variables: { organization_id: 'org_saved' },
      }),
      saveConnectionVariable: jest.fn().mockResolvedValue(undefined),
    };
    gcp = {
      detectOrganizations: jest.fn().mockResolvedValue([]),
      detectProjectsForOrg: jest
        .fn()
        .mockResolvedValue([{ id: 'prj-1', name: 'Payments', number: '1' }]),
      detectProjects: jest.fn().mockResolvedValue([]),
      autoSetup: jest.fn().mockResolvedValue({
        steps: [{ id: 'enable_service_usage_api', success: false }],
      }),
      resolveSetupStep: jest.fn().mockResolvedValue({
        email: 'admin@example.com',
        step: { id: 'enable_service_usage_api', success: true },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudSecurityGcpController],
      providers: [
        { provide: CloudSecurityService, useValue: services },
        { provide: GCPSecurityService, useValue: gcp },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CloudSecurityGcpController);
    jest.clearAllMocks();
  });

  it('setupGcp adds resolve actions to failed steps', async () => {
    const result = await controller.setupGcp('conn_1', {}, 'org_1');

    const step = result.steps[0] as {
      resolveAction?: { endpoint: string };
    };
    expect(step.resolveAction?.endpoint).toBe(
      '/v1/cloud-security/setup-gcp/conn_1/resolve-step',
    );
    expect(result.projectId).toBe('prj-1');
  });

  it('resolveGcpSetupStep returns the resolved step with resolve actions stripped', async () => {
    const result = await controller.resolveGcpSetupStep(
      'conn_1',
      { stepId: 'enable_service_usage_api' },
      'org_1',
    );

    expect(result.email).toBe('admin@example.com');
    expect(result.step.id).toBe('enable_service_usage_api');
    expect(
      (result.step as { resolveAction?: unknown }).resolveAction,
    ).toBeUndefined();
  });
});
