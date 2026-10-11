import { Test, TestingModule } from '@nestjs/testing';
import { SyncController } from './sync.controller';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { ConnectionRepository } from '../repositories/connection.repository';
import { CredentialVaultService } from '../services/credential-vault.service';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { IntegrationSyncLoggerService } from '../services/integration-sync-logger.service';
import { GenericEmployeeSyncService } from '../services/generic-employee-sync.service';
import { GenericDeviceSyncService } from '../services/generic-device-sync.service';
import { DynamicIntegrationRepository } from '../repositories/dynamic-integration.repository';
import { CheckRunRepository } from '../repositories/check-run.repository';
import { db } from '@db';

const mockedDb = db as jest.Mocked<typeof db>;

export async function createHrSyncControllerFixture({
  mockFetch,
}: {
  mockFetch: jest.Mock;
}) {
  const orgId = 'org_test123';
  const connectionId = 'conn_test123';
  const email = 'employee@example.com';

  const mockConnectionRepo = {
    findById: jest.fn<
      ReturnType<ConnectionRepository['findById']>,
      Parameters<ConnectionRepository['findById']>
    >(),
    findBySlugAndOrg: jest.fn(),
    update: jest.fn(),
  };

  const mockCredentialVault = {
    getDecryptedCredentials: jest.fn(),
    refreshOAuthTokens: jest.fn(),
  };

  const mockOAuthCredentials = {
    getCredentials: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [SyncController],
    providers: [
      { provide: ConnectionRepository, useValue: mockConnectionRepo },
      { provide: CredentialVaultService, useValue: mockCredentialVault },
      { provide: OAuthCredentialsService, useValue: mockOAuthCredentials },
      {
        provide: IntegrationSyncLoggerService,
        useValue: { logSync: jest.fn() },
      },
      { provide: GenericEmployeeSyncService, useValue: {} },
      { provide: GenericDeviceSyncService, useValue: {} },
      { provide: DynamicIntegrationRepository, useValue: {} },
      { provide: CheckRunRepository, useValue: {} },
    ],
  })
    .overrideGuard(HybridAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const controller = module.get<SyncController>(SyncController);

  function setupProvider({
    provider,
    inactive = false,
    excluded = false,
  }: {
    provider: string;
    inactive?: boolean;
    excluded?: boolean;
  }) {
    mockConnectionRepo.findById.mockResolvedValue({
      id: connectionId,
      organizationId: orgId,
      providerId: 'prov_1',
      variables: excluded
        ? { sync_user_filter_mode: 'exclude', sync_excluded_emails: email }
        : {},
      status: 'active',
      authStrategy: 'oauth2',
      activeCredentialVersionId: null,
      lastSyncAt: null,
      nextSyncAt: null,
      syncCadence: null,
      metadata: null,
      errorMessage: null,
      refreshLeaseUntil: null,
      refreshLeaseToken: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (mockedDb.integrationProvider.findUnique as jest.Mock).mockResolvedValue({
      slug: provider,
    });
    mockCredentialVault.getDecryptedCredentials.mockResolvedValue({
      access_token: 'token',
      api_key: 'key',
    });
    (mockedDb.member.findMany as jest.Mock).mockResolvedValue([]);
    (mockedDb.member.findFirst as jest.Mock).mockResolvedValue(null);
    function responseForUrl(url: string) {
      if (provider === 'google-workspace')
        return {
          users: [
            {
              primaryEmail: email,
              name: { fullName: 'Employee' },
              suspended: inactive,
            },
          ],
        };
      if (provider === 'rippling')
        return {
          results: [
            { work_email: email, status: inactive ? 'TERMINATED' : 'ACTIVE' },
          ],
        };
      if (url.includes('/systemusers'))
        return {
          totalCount: 1,
          results: [
            {
              _id: 'jc_1',
              email,
              username: 'employee',
              state: inactive ? 'SUSPENDED' : 'ACTIVATED',
              activated: !inactive,
              suspended: inactive,
            },
          ],
        };
      if (url.includes('/v2/users/')) return [];
      return { results: [], totalCount: 0 };
    }
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(responseForUrl(url)),
      }),
    );
  }

  function runSync(provider: string) {
    if (provider === 'google-workspace')
      return controller.syncGoogleWorkspaceEmployees(orgId, connectionId);
    if (provider === 'rippling')
      return controller.syncRipplingEmployees(orgId, connectionId);
    return controller.syncJumpCloudEmployees(orgId, connectionId);
  }

  return { controller, setupProvider, runSync };
}
