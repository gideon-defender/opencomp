import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConnectionsController } from './connections.controller';
import { trimAwsCredentialStrings } from './connections.controller';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { ConnectionService } from '../services/connection.service';
import { CredentialVaultService } from '../services/credential-vault.service';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { AutoCheckRunnerService } from '../services/auto-check-runner.service';
import { ProviderRepository } from '../repositories/provider.repository';
import { ConnectionRepository } from '../repositories/connection.repository';

jest.mock('../../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {
    integration: ['create', 'read', 'update', 'delete'],
  },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

jest.mock('@db', () => ({
  db: {
    integrationProvider: { findUnique: jest.fn() },
  },
}));

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn(),
  AssumeRoleCommand: jest.fn((input: unknown) => ({ input })),
  GetCallerIdentityCommand: jest.fn(() => ({})),
}));

jest.mock('@gideon-defender/integration-platform', () => {
  // Real pure helpers (role-name constants, pair-map parse) with mocked
  // manifest accessors — the controller under test needs both.
  const actual = jest.requireActual('@gideon-defender/integration-platform');
  return {
    ...(actual as Record<string, unknown>),
    getManifest: jest.fn(),
    getAllManifests: jest.fn(),
    getActiveManifests: jest.fn(),
    TASK_TEMPLATE_INFO: {},
  };
});

import {
  getManifest,
  getAllManifests,
  getActiveManifests,
} from '@gideon-defender/integration-platform';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

const mockedGetManifest = getManifest as jest.MockedFunction<
  typeof getManifest
>;
const mockedGetAllManifests = getAllManifests as jest.MockedFunction<
  typeof getAllManifests
>;
const mockedGetActiveManifests = getActiveManifests as jest.MockedFunction<
  typeof getActiveManifests
>;

describe('ConnectionsController', () => {
  let controller: ConnectionsController;

  const mockConnectionService = {
    getOrganizationConnections: jest.fn(),
    getConnection: jest.fn(),
    getConnectionForOrg: jest.fn(),
    createConnection: jest.fn(),
    activateConnection: jest.fn(),
    pauseConnection: jest.fn(),
    disconnectConnection: jest.fn(),
    deleteConnection: jest.fn(),
    setConnectionError: jest.fn(),
    updateConnectionMetadata: jest.fn(),
  };

  const mockCredentialVaultService = {
    storeApiKeyCredentials: jest.fn(),
    getDecryptedCredentials: jest.fn(),
    needsRefresh: jest.fn(),
    refreshOAuthTokens: jest.fn(),
  };

  const mockOAuthCredentialsService = {
    checkAvailability: jest.fn(),
    getCredentials: jest.fn(),
  };

  const mockAutoCheckRunnerService = {
    tryAutoRunChecks: jest.fn().mockResolvedValue(false),
  };

  const mockProviderRepository = {
    upsert: jest.fn(),
  };

  const mockConnectionRepository = {
    update: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionsController],
      providers: [
        { provide: ConnectionService, useValue: mockConnectionService },
        {
          provide: CredentialVaultService,
          useValue: mockCredentialVaultService,
        },
        {
          provide: OAuthCredentialsService,
          useValue: mockOAuthCredentialsService,
        },
        {
          provide: AutoCheckRunnerService,
          useValue: mockAutoCheckRunnerService,
        },
        { provide: ProviderRepository, useValue: mockProviderRepository },
        { provide: ConnectionRepository, useValue: mockConnectionRepository },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<ConnectionsController>(ConnectionsController);

    jest.clearAllMocks();
    mockAutoCheckRunnerService.tryAutoRunChecks.mockResolvedValue(false);
    mockConnectionService.getConnectionForOrg.mockResolvedValue({
      id: 'conn_1',
      organizationId: 'org_1',
      status: 'active',
      provider: { slug: 'datadog' },
      metadata: {},
      variables: {},
    });
  });

  describe('listProviders', () => {
    it('should return all manifests when activeOnly is not set', async () => {
      const manifests = [
        {
          id: 'github',
          name: 'GitHub',
          description: 'GitHub integration',
          category: 'dev',
          logoUrl: '/github.svg',
          auth: { type: 'oauth2' },
          capabilities: ['checks'],
          isActive: true,
          docsUrl: 'https://docs.example.com',
          credentialFields: [],
          checks: [],
          variables: [],
        },
      ];
      mockedGetAllManifests.mockReturnValue(manifests as never);
      mockOAuthCredentialsService.checkAvailability.mockResolvedValue({
        hasPlatformCredentials: true,
      });

      const result = await controller.listProviders();

      expect(mockedGetAllManifests).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('github');
    });

    it('should return active manifests when activeOnly is true', async () => {
      mockedGetActiveManifests.mockReturnValue([]);

      await controller.listProviders('true');

      expect(mockedGetActiveManifests).toHaveBeenCalled();
    });
  });

  describe('getProvider', () => {
    it('should return provider details', () => {
      const manifest = {
        id: 'github',
        name: 'GitHub',
        description: 'GitHub integration',
        category: 'dev',
        logoUrl: '/github.svg',
        auth: { type: 'oauth2' },
        capabilities: ['checks'],
        isActive: true,
        docsUrl: 'https://docs.example.com',
        credentialFields: [],
        checks: [],
        variables: [],
      };
      mockedGetManifest.mockReturnValue(manifest as never);

      const result = controller.getProvider('github');

      expect(result.id).toBe('github');
      expect(result.name).toBe('GitHub');
    });

    it('should throw NOT_FOUND when provider does not exist', () => {
      mockedGetManifest.mockReturnValue(undefined);

      expect(() => controller.getProvider('nonexistent')).toThrow(
        HttpException,
      );
    });
  });

  describe('listConnections', () => {
    it('should call service.getOrganizationConnections', async () => {
      const connections = [
        {
          id: 'conn_1',
          providerId: 'prov_1',
          provider: { slug: 'github', name: 'GitHub' },
          status: 'active',
          authStrategy: 'oauth2',
          lastSyncAt: null,
          nextSyncAt: null,
          errorMessage: null,
          variables: {},
          metadata: {},
          createdAt: new Date(),
        },
      ];
      mockConnectionService.getOrganizationConnections.mockResolvedValue(
        connections,
      );

      const result = await controller.listConnections('org_1');

      expect(
        mockConnectionService.getOrganizationConnections,
      ).toHaveBeenCalledWith('org_1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('conn_1');
      expect(result[0].providerSlug).toBe('github');
    });
  });

  describe('getConnection', () => {
    it('should return connection details', async () => {
      const connection = {
        id: 'conn_1',
        providerId: 'prov_1',
        provider: { slug: 'github', name: 'GitHub' },
        status: 'active',
        authStrategy: 'oauth2',
        lastSyncAt: null,
        nextSyncAt: null,
        syncCadence: null,
        metadata: {},
        variables: {},
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockConnectionService.getConnectionForOrg.mockResolvedValue(connection);
      mockedGetManifest.mockReturnValue(undefined);

      const result = await controller.getConnection('conn_1', 'org_1');

      expect(mockConnectionService.getConnectionForOrg).toHaveBeenCalledWith(
        'conn_1',
        'org_1',
      );
      expect(result.id).toBe('conn_1');
      expect(result.providerSlug).toBe('github');
    });
  });

  describe('createConnection', () => {
    it('should create a connection for non-OAuth provider', async () => {
      const manifest = {
        id: 'datadog',
        name: 'Datadog',
        category: 'monitoring',
        auth: { type: 'api_key', config: { name: 'api_key' } },
        capabilities: ['checks'],
        isActive: true,
        credentialFields: [],
        checks: [],
      };
      mockedGetManifest.mockReturnValue(manifest as never);
      mockProviderRepository.upsert.mockResolvedValue(undefined);
      mockConnectionService.createConnection.mockResolvedValue({
        id: 'conn_new',
        providerId: 'prov_dd',
        authStrategy: 'api_key',
        createdAt: new Date(),
      });
      mockConnectionService.activateConnection.mockResolvedValue(undefined);

      const result = await controller.createConnection('org_1', {
        providerSlug: 'datadog',
        credentials: { api_key: 'test-key' },
      });

      expect(mockProviderRepository.upsert).toHaveBeenCalled();
      expect(mockConnectionService.createConnection).toHaveBeenCalledWith({
        providerSlug: 'datadog',
        organizationId: 'org_1',
        authStrategy: 'api_key',
        metadata: undefined,
      });
      expect(
        mockCredentialVaultService.storeApiKeyCredentials,
      ).toHaveBeenCalledWith('conn_new', { api_key: 'test-key' });
      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_new',
      );
      expect(result.id).toBe('conn_new');
      expect(result.status).toBe('active');
    });

    it('should throw NOT_FOUND when provider does not exist', async () => {
      mockedGetManifest.mockReturnValue(undefined);

      await expect(
        controller.createConnection('org_1', {
          providerSlug: 'nonexistent',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw BAD_REQUEST for OAuth providers', async () => {
      const manifest = {
        id: 'github',
        name: 'GitHub',
        auth: { type: 'oauth2' },
      };
      mockedGetManifest.mockReturnValue(manifest as never);

      await expect(
        controller.createConnection('org_1', {
          providerSlug: 'github',
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('testConnection', () => {
    it('should throw NOT_FOUND when provider slug is missing', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        provider: undefined,
      });

      await expect(
        controller.testConnection('conn_1', 'org_1'),
      ).rejects.toThrow(HttpException);
    });

    it('should throw BAD_REQUEST when no credentials found', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        provider: { slug: 'datadog' },
      });
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        null,
      );

      await expect(
        controller.testConnection('conn_1', 'org_1'),
      ).rejects.toThrow(HttpException);
    });

    it('should activate connection when no handler is defined', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        provider: { slug: 'custom-provider' },
      });
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        api_key: 'test',
      });
      mockedGetManifest.mockReturnValue({
        auth: { type: 'api_key' },
        handler: undefined,
      } as never);
      mockConnectionService.activateConnection.mockResolvedValue(undefined);

      const result = await controller.testConnection('conn_1', 'org_1');

      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_1',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('pauseConnection', () => {
    it('should call service.pauseConnection', async () => {
      mockConnectionService.pauseConnection.mockResolvedValue({
        id: 'conn_1',
        status: 'paused',
      });

      const result = await controller.pauseConnection('conn_1', 'org_1');

      expect(mockConnectionService.pauseConnection).toHaveBeenCalledWith(
        'conn_1',
      );
      expect(result).toEqual({ id: 'conn_1', status: 'paused' });
    });
  });

  describe('resumeConnection', () => {
    it('should call service.activateConnection', async () => {
      mockConnectionService.activateConnection.mockResolvedValue({
        id: 'conn_1',
        status: 'active',
      });

      const result = await controller.resumeConnection('conn_1', 'org_1');

      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_1',
      );
      expect(result).toEqual({ id: 'conn_1', status: 'active' });
    });
  });

  describe('disconnectConnection', () => {
    it('should call service.disconnectConnection', async () => {
      mockConnectionService.disconnectConnection.mockResolvedValue({
        id: 'conn_1',
        status: 'disconnected',
      });

      const result = await controller.disconnectConnection('conn_1', 'org_1');

      expect(mockConnectionService.disconnectConnection).toHaveBeenCalledWith(
        'conn_1',
      );
      expect(result).toEqual({ id: 'conn_1', status: 'disconnected' });
    });
  });

  describe('deleteConnection', () => {
    it('should call service.deleteConnection', async () => {
      mockConnectionService.deleteConnection.mockResolvedValue(undefined);

      const result = await controller.deleteConnection('conn_1', 'org_1');

      expect(mockConnectionService.deleteConnection).toHaveBeenCalledWith(
        'conn_1',
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('updateConnection', () => {
    it('should merge metadata and update', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        metadata: { existing: 'value' },
      });
      mockConnectionService.updateConnectionMetadata.mockResolvedValue(
        undefined,
      );

      const result = await controller.updateConnection('conn_1', 'org_1', {
        metadata: { newField: 'newValue' },
      });

      expect(
        mockConnectionService.updateConnectionMetadata,
      ).toHaveBeenCalledWith('conn_1', {
        existing: 'value',
        newField: 'newValue',
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw FORBIDDEN when org does not match', async () => {
      mockConnectionService.getConnectionForOrg.mockRejectedValue(
        new HttpException('Connection not found', HttpStatus.NOT_FOUND),
      );

      await expect(
        controller.updateConnection('conn_1', 'org_1', {
          metadata: { key: 'val' },
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('ensureValidCredentials', () => {
    it('should throw NOT_FOUND when org does not match', async () => {
      mockConnectionService.getConnectionForOrg.mockRejectedValue(
        new HttpException('Connection not found', HttpStatus.NOT_FOUND),
      );

      await expect(
        controller.ensureValidCredentials('conn_1', 'org_1'),
      ).rejects.toThrow(HttpException);
    });

    it('should throw BAD_REQUEST when connection is not active', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'paused',
      });

      await expect(
        controller.ensureValidCredentials('conn_1', 'org_1'),
      ).rejects.toThrow(HttpException);
    });

    it('should return credentials for api_key auth', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'datadog' },
      });
      mockedGetManifest.mockReturnValue({
        auth: { type: 'api_key', config: { name: 'api_key' } },
      } as never);
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        api_key: 'test-key',
      });

      const result = await controller.ensureValidCredentials('conn_1', 'org_1');

      expect(result.success).toBe(true);
      expect(result.credentials).toEqual({ api_key: 'test-key' });
    });

    it('force refreshes OAuth credentials even when stored expiry is not due', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'gcp' },
      });
      mockedGetManifest.mockReturnValue({
        auth: {
          type: 'oauth2',
          config: {
            tokenUrl: 'https://oauth2.googleapis.com/token',
            refreshUrl: undefined,
            clientAuthMethod: 'body',
            supportsRefreshToken: true,
            tokenParams: undefined,
          },
        },
      } as never);
      mockCredentialVaultService.needsRefresh.mockResolvedValue(false);
      mockOAuthCredentialsService.getCredentials.mockResolvedValue({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      mockCredentialVaultService.refreshOAuthTokens.mockResolvedValue(
        'fresh-token',
      );
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        access_token: 'fresh-token',
      });

      const result = await controller.ensureValidCredentials(
        'conn_1',
        'org_1',
        {
          forceRefresh: true,
        },
      );

      expect(mockCredentialVaultService.needsRefresh).not.toHaveBeenCalled();
      expect(
        mockCredentialVaultService.refreshOAuthTokens,
      ).toHaveBeenCalledWith('conn_1', {
        tokenUrl: 'https://oauth2.googleapis.com/token',
        refreshUrl: undefined,
        clientId: 'client-id',
        clientSecret: 'client-secret',
        clientAuthMethod: 'body',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        tokenParams: undefined,
      });
      expect(result.credentials).toEqual({ access_token: 'fresh-token' });
    });
  });

  describe('updateCredentials', () => {
    it('should throw NOT_FOUND when org does not match', async () => {
      mockConnectionService.getConnectionForOrg.mockRejectedValue(
        new HttpException('Connection not found', HttpStatus.NOT_FOUND),
      );

      await expect(
        controller.updateCredentials('conn_1', 'org_1', {
          credentials: { api_key: 'new' },
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw BAD_REQUEST for OAuth integrations', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        provider: { slug: 'github' },
      });
      mockedGetManifest.mockReturnValue({
        auth: { type: 'oauth2' },
      } as never);

      await expect(
        controller.updateCredentials('conn_1', 'org_1', {
          credentials: { token: 'new' },
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should merge and store credentials', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'datadog' },
      });
      mockedGetManifest.mockReturnValue({
        id: 'datadog',
        auth: { type: 'api_key', config: { name: 'api_key' } },
      } as never);
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        api_key: 'old-key',
        app_key: 'existing',
      });

      const result = await controller.updateCredentials('conn_1', 'org_1', {
        credentials: { api_key: 'new-key' },
      });

      expect(
        mockCredentialVaultService.storeApiKeyCredentials,
      ).toHaveBeenCalledWith('conn_1', {
        api_key: 'new-key',
        app_key: 'existing',
      });
      expect(result).toEqual({ success: true });
    });

    it('should activate connection if it was in error state', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'error',
        provider: { slug: 'datadog' },
      });
      mockedGetManifest.mockReturnValue({
        id: 'datadog',
        auth: { type: 'api_key', config: { name: 'api_key' } },
      } as never);
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({});

      await controller.updateCredentials('conn_1', 'org_1', {
        credentials: { api_key: 'new-key' },
      });

      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_1',
      );
    });
  });

  describe('AWS server-generated External IDs', () => {
    const stsCtor = STSClient as unknown as jest.Mock;
    const stsSend = jest.fn();
    const previousAssumerArn = process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;

    const AUDITOR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Auditor';

    function awsManifest() {
      return {
        id: 'aws',
        name: 'AWS',
        category: 'Cloud',
        auth: { type: 'custom', config: {} },
        capabilities: ['checks'],
        isActive: true,
        checks: [],
      } as never;
    }

    function storedCreds() {
      return {
        Credentials: {
          AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
        },
      };
    }

    beforeEach(() => {
      process.env.SECURITY_HUB_ROLE_ASSUMER_ARN =
        'arn:aws:iam::999999999999:role/CompRoleAssumer';
      stsCtor.mockImplementation(() => ({ send: stsSend }));
      stsSend.mockImplementation(async (cmd: unknown) => {
        const input = (cmd as { input?: Record<string, unknown> }).input;
        if (!input) {
          return {
            Arn: `arn:aws:sts::123456789012:assumed-role/OpenComp-Auditor/CompValidation`,
            Account: '123456789012',
          };
        }
        return storedCreds();
      });
      mockedGetManifest.mockReturnValue(awsManifest());
      mockProviderRepository.upsert.mockResolvedValue(undefined);
      mockConnectionService.createConnection.mockResolvedValue({
        id: 'conn_new',
        providerId: 'prov_aws',
        authStrategy: 'custom',
        createdAt: new Date(),
      });
      mockConnectionService.activateConnection.mockResolvedValue(undefined);
    });

    afterAll(() => {
      if (previousAssumerArn === undefined) {
        delete process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;
      } else {
        process.env.SECURITY_HUB_ROLE_ASSUMER_ARN = previousAssumerArn;
      }
    });

    it('ignores a client-supplied externalId on create and mints one', async () => {
      const result = await controller.createConnection('org_1', {
        providerSlug: 'aws',
        credentials: {
          connectionName: 'Prod',
          awsType: 'aws',
          roleArn: AUDITOR_ARN,
          externalId: 'user-typed-guessable',
          regions: ['us-east-1'],
        },
      });

      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toMatch(/^org_org_1_[0-9a-f-]{36}$/);
      expect(stored.externalId).not.toBe('user-typed-guessable');
      expect(result.status).toBe('active');
      expect(result.externalId).toBe(stored.externalId);
      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_new',
      );
    });

    it('creates a pending connection without validation when no Role ARN is sent', async () => {
      const result = await controller.createConnection('org_1', {
        providerSlug: 'aws',
        credentials: {
          connectionName: 'Prod',
          awsType: 'aws',
          regions: ['us-east-1'],
        },
      });

      // No STS traffic: the IAM role cannot exist yet.
      expect(stsCtor).not.toHaveBeenCalled();
      expect(mockConnectionService.activateConnection).not.toHaveBeenCalled();
      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toMatch(/^org_org_1_[0-9a-f-]{36}$/);
      expect(result.status).toBe('pending');
      expect(result.externalId).toBe(stored.externalId);
      // The setup UI reads the display value from metadata.
      const created = mockConnectionService.createConnection.mock.calls[0][0];
      expect(created.metadata.externalId).toBe(stored.externalId);
    });

    it('mints an externalId for AWS even when no credentials are sent', async () => {
      const result = await controller.createConnection('org_1', {
        providerSlug: 'aws',
      });

      // No STS traffic: the IAM role cannot exist yet.
      expect(stsCtor).not.toHaveBeenCalled();
      expect(mockConnectionService.activateConnection).not.toHaveBeenCalled();
      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toMatch(/^org_org_1_[0-9a-f-]{36}$/);
      expect(result.status).toBe('pending');
      expect(result.externalId).toBe(stored.externalId);
      // The vault holds the minted value, so phase 2 can pin it.
      const created = mockConnectionService.createConnection.mock.calls[0][0];
      expect(created.metadata.externalId).toBe(stored.externalId);
    });

    it('pins the stored externalId on update and ignores client rotation', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
      });
      const storedExternalId = `org_org_1_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        externalId: storedExternalId,
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: {
          roleArn: AUDITOR_ARN,
          externalId: 'attacker-chosen-value',
          regions: ['us-east-1'],
        },
      });

      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toBe(storedExternalId);
    });

    it('lets a legacy connection without a stored externalId adopt the client value', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_legacy',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
      });
      // No externalId on file: nothing to pin, so the client value flows
      // into validation and the vault instead of being dropped.
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      await controller.updateCredentials('conn_legacy', 'org_1', {
        credentials: {
          roleArn: AUDITOR_ARN,
          externalId: 'org_org_1_legacy-typed',
          regions: ['us-east-1'],
        },
      });

      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toBe('org_org_1_legacy-typed');
    });

    it('syncs the pinned externalId to metadata on credential updates', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        metadata: { connectionName: 'Prod' },
        provider: { slug: 'aws' },
      });
      const storedExternalId = `org_org_1_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        externalId: storedExternalId,
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: { roleArn: AUDITOR_ARN },
      });

      // The display value follows the vault, never the client.
      expect(mockConnectionRepository.update).toHaveBeenCalledWith(
        'conn_aws',
        expect.objectContaining({
          metadata: expect.objectContaining({ externalId: storedExternalId }),
        }),
      );
    });

    it('activates a pending AWS connection once credentials validate', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'pending',
        provider: { slug: 'aws' },
      });
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        externalId: 'org_org_1_secret',
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      const result = await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: { roleArn: AUDITOR_ARN },
      });

      expect(result).toEqual({ success: true });
      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_aws',
      );
    });

    it('does not auto-activate pending connections for unverified providers', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'pending',
        provider: { slug: 'datadog' },
      });
      mockedGetManifest.mockReturnValue({
        id: 'datadog',
        auth: { type: 'api_key', config: { name: 'api_key' } },
      } as never);
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({});

      await controller.updateCredentials('conn_1', 'org_1', {
        credentials: { api_key: 'new-key' },
      });

      expect(mockConnectionService.activateConnection).not.toHaveBeenCalled();
    });

    it('strips externalId from PATCH metadata updates', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        metadata: { existing: 'value' },
      });

      await controller.updateConnection('conn_1', 'org_1', {
        metadata: { connectionName: 'Renamed', externalId: 'spoofed' },
      });

      expect(
        mockConnectionService.updateConnectionMetadata,
      ).toHaveBeenCalledWith('conn_1', {
        existing: 'value',
        connectionName: 'Renamed',
      });
    });

    it('deletes the row when the vault write fails (no orphan pending row)', async () => {
      mockCredentialVaultService.storeApiKeyCredentials.mockRejectedValueOnce(
        new Error('vault down'),
      );

      await expect(
        controller.createConnection('org_1', {
          providerSlug: 'aws',
          credentials: {
            awsType: 'aws',
            regions: ['us-east-1'],
          },
        }),
      ).rejects.toThrow('vault down');
      expect(mockConnectionService.deleteConnection).toHaveBeenCalledWith(
        'conn_new',
      );
    });

    it('mints a fresh externalId on update when neither stored nor client value exists', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_legacy',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
      });
      // Legacy vault row with no externalId, and the UI sends none either.
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      const result = await controller.updateCredentials(
        'conn_legacy',
        'org_1',
        {
          credentials: { roleArn: AUDITOR_ARN },
        },
      );

      expect(result).toEqual({ success: true });
      const stored =
        mockCredentialVaultService.storeApiKeyCredentials.mock.calls[0][1];
      expect(stored.externalId).toMatch(/^org_org_1_[0-9a-f-]{36}$/);
      expect(mockConnectionRepository.update).toHaveBeenCalledWith(
        'conn_legacy',
        expect.objectContaining({
          metadata: expect.objectContaining({
            externalId: stored.externalId,
          }),
        }),
      );
    });

    it('does not activate paused connections on credential updates', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        status: 'paused',
        provider: { slug: 'datadog' },
      });
      mockedGetManifest.mockReturnValue({
        id: 'datadog',
        auth: { type: 'api_key', config: { name: 'api_key' } },
      } as never);
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({});

      await controller.updateCredentials('conn_1', 'org_1', {
        credentials: { api_key: 'new-key' },
      });

      expect(mockConnectionService.activateConnection).not.toHaveBeenCalled();
    });

    it('syncs connectionName and awsScanMode to metadata on credential updates', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        metadata: {},
        provider: { slug: 'aws' },
      });
      const storedExternalId = `org_org_1_${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        externalId: storedExternalId,
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: {
          roleArn: AUDITOR_ARN,
          connectionName: 'Prod Renamed',
          awsScanMode: 'security_hub',
        },
      });

      expect(mockConnectionRepository.update).toHaveBeenCalledWith(
        'conn_aws',
        expect.objectContaining({
          metadata: expect.objectContaining({
            connectionName: 'Prod Renamed',
            awsScanMode: 'security_hub',
          }),
        }),
      );
    });

    it('rejects stored externalIds outside the STS charset before any STS call', async () => {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
      });
      // Legacy vault row with a value that predates server-side minting and
      // carries characters the CloudShell scripts cannot safely interpolate.
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue({
        roleArn: AUDITOR_ARN,
        externalId: 'evil value with spaces',
        regions: ['us-east-1'],
        awsType: 'aws',
      });

      await expect(
        controller.updateCredentials('conn_aws', 'org_1', {
          credentials: { roleArn: AUDITOR_ARN },
        }),
      ).rejects.toThrow(HttpException);
      expect(stsCtor).not.toHaveBeenCalled();
    });
  });

  describe('testConnection (AWS validation)', () => {
    const stsCtor = STSClient as unknown as jest.Mock;
    const assumeCmd = AssumeRoleCommand as unknown as jest.Mock;
    const stsSend = jest.fn();
    const previousAssumerArn = process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;

    const AUDITOR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Auditor';
    const REMEDIATOR_ARN = 'arn:aws:iam::123456789012:role/OpenComp-Remediator';

    function stsCreds() {
      return {
        Credentials: {
          AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          SecretAccessKey: 'secret',
          SessionToken: 'token',
        },
      };
    }

    function awsConnection() {
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
      });
    }

    function awsCredentials(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        roleArn: AUDITOR_ARN,
        externalId: 'org_1-secret',
        regions: ['us-east-1'],
        awsType: 'aws',
        remediationRoleArn: REMEDIATOR_ARN,
        ...overrides,
      };
    }

    beforeEach(() => {
      process.env.SECURITY_HUB_ROLE_ASSUMER_ARN =
        'arn:aws:iam::999999999999:role/CompRoleAssumer';
      stsCtor.mockImplementation(() => ({ send: stsSend }));
      // Default: every assume succeeds EXCEPT a remediation assume without
      // an External ID (the trust policy correctly requires it), and
      // identity verification returns the auditor account.
      stsSend.mockImplementation(async (cmd: unknown) => {
        const input = (cmd as { input?: Record<string, unknown> }).input;
        if (!input) {
          return {
            Arn: `arn:aws:sts::123456789012:assumed-role/OpenComp-Auditor/CompValidation`,
            Account: '123456789012',
          };
        }
        if (
          typeof input.RoleArn === 'string' &&
          input.RoleArn.includes('Remediator') &&
          input.ExternalId === undefined
        ) {
          throw new Error(
            'AccessDenied: is not authorized to perform: sts:AssumeRole',
          );
        }
        return stsCreds();
      });
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials(),
      );
      awsConnection();
    });

    afterAll(() => {
      if (previousAssumerArn === undefined) {
        delete process.env.SECURITY_HUB_ROLE_ASSUMER_ARN;
      } else {
        process.env.SECURITY_HUB_ROLE_ASSUMER_ARN = previousAssumerArn;
      }
    });

    it('validates the remediation role with a 900s session when the trust policy requires the External ID', async () => {
      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Remediation roles validated');
      // The remediation assume uses a 15-minute session.
      const remediationCall = assumeCmd.mock.calls.find(
        (call) =>
          (call[0] as { RoleArn?: string }).RoleArn === REMEDIATOR_ARN &&
          (call[0] as { ExternalId?: string }).ExternalId !== undefined,
      );
      expect(remediationCall).toBeDefined();
      expect(remediationCall?.[0]).toMatchObject({
        RoleSessionName: 'CompValidation',
        DurationSeconds: 900,
      });
      expect(mockConnectionService.activateConnection).toHaveBeenCalledWith(
        'conn_aws',
      );
    });

    it('fails when the remediation role can be assumed without the External ID', async () => {
      // Trust policy too open: assume without External ID succeeds.
      stsSend.mockImplementation(async (cmd: unknown) => {
        const input = (cmd as { input?: Record<string, unknown> }).input;
        if (!input) {
          return {
            Arn: 'arn:aws:sts::123456789012:assumed-role/OpenComp-Auditor/CompValidation',
            Account: '123456789012',
          };
        }
        return stsCreds();
      });

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not require the External ID');
      expect(mockConnectionService.setConnectionError).toHaveBeenCalledWith(
        'conn_aws',
        expect.stringContaining('does not require the External ID'),
      );
    });

    it('fails visibly when the ExternalId probe errors inconclusively', async () => {
      // A network error on the negative probe must not certify the policy.
      stsSend.mockImplementation(async (cmd: unknown) => {
        const input = (cmd as { input?: Record<string, unknown> }).input;
        if (!input) {
          return {
            Arn: 'arn:aws:sts::123456789012:assumed-role/OpenComp-Auditor/CompValidation',
            Account: '123456789012',
          };
        }
        if (
          typeof input.RoleArn === 'string' &&
          input.RoleArn.includes('Remediator') &&
          input.ExternalId === undefined
        ) {
          throw new Error('NetworkingError: socket hang up');
        }
        return stsCreds();
      });

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('socket hang up');
    });

    it('rejects placeholder External IDs before any STS call', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({ externalId: 'YOUR_EXTERNAL_ID' }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('placeholder');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('rejects cross-account remediation role ARNs without calling STS', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn:
            'arn:aws:iam::999999999999:role/OpenComp-Remediator',
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('must match the auditor');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('rejects non-remediator role names without calling STS', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: 'arn:aws:iam::123456789012:role/Admin',
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('must reference OpenComp-Remediator');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('skips remediation validation when no remediation role is configured', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({ remediationRoleArn: undefined }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(true);
      expect(result.message).not.toContain('Remediation role validated');
      const remediationCall = assumeCmd.mock.calls.find(
        (call) => (call[0] as { RoleArn?: string }).RoleArn === REMEDIATOR_ARN,
      );
      expect(remediationCall).toBeUndefined();
    });

    it('accepts a valid remediationRoles pair map', async () => {
      const pairArn =
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': pairArn }),
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(true);
      // The pair ARN was assumed with the External ID — without this, the
      // map would be silently ignored and success would prove nothing.
      const pairCall = assumeCmd.mock.calls.find(
        (call) =>
          (call[0] as { RoleArn?: string }).RoleArn === pairArn &&
          (call[0] as { ExternalId?: string }).ExternalId !== undefined,
      );
      expect(pairCall).toBeDefined();
      // …and the negative probe ran for it too.
      const probeCall = assumeCmd.mock.calls.find(
        (call) =>
          (call[0] as { RoleArn?: string }).RoleArn === pairArn &&
          (call[0] as { ExternalId?: string }).ExternalId === undefined,
      );
      expect(probeCall).toBeDefined();
    });

    it('rejects invalid pair-map entries without calling STS', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: JSON.stringify({
            'Storage:us-east-1': 'arn:aws:iam::123456789012:role/Admin',
          }),
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('must reference OpenComp-Remediator');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('rejects malformed pair-map JSON without calling STS', async () => {
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: 'not-json',
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be a JSON object');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('rejects object-form remediationRoles without calling STS', async () => {
      // Storage and validation both expect the JSON-string shape — an
      // object would skip every pair check yet still persist downstream.
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: {
            'Storage:us-east-1':
              'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
          },
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('must be a JSON object');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('rejects External IDs with line breaks without calling STS', async () => {
      // The External ID is interpolated into generated setup scripts — a
      // newline breaks out of the assignment and injects shell commands.
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({ externalId: 'org_1\nINJECTED=true' }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('line breaks');
      expect(stsSend).not.toHaveBeenCalled();
    });

    it('proves the External ID trust for every pair entry, not just the legacy ARN', async () => {
      const pairArn =
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': pairArn }),
        }),
      );

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(true);
      // The pair ARN was assumed with the External ID…
      const pairCall = assumeCmd.mock.calls.find(
        (call) =>
          (call[0] as { RoleArn?: string }).RoleArn === pairArn &&
          (call[0] as { ExternalId?: string }).ExternalId !== undefined,
      );
      expect(pairCall).toBeDefined();
      // …and the negative probe ran for it too.
      const probeCall = assumeCmd.mock.calls.find(
        (call) =>
          (call[0] as { RoleArn?: string }).RoleArn === pairArn &&
          (call[0] as { ExternalId?: string }).ExternalId === undefined,
      );
      expect(probeCall).toBeDefined();
    });

    it('fails when a pair role can be assumed without the External ID', async () => {
      const pairArn =
        'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1';
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: JSON.stringify({ 'Storage:us-east-1': pairArn }),
        }),
      );
      // Open trust on the pair role: the negative probe succeeds.
      stsSend.mockImplementation(async (cmd: unknown) => {
        const input = (cmd as { input?: Record<string, unknown> }).input;
        if (!input) {
          return {
            Arn: 'arn:aws:sts::123456789012:assumed-role/OpenComp-Auditor/CompValidation',
            Account: '123456789012',
          };
        }
        return stsCreds();
      });

      const result = await controller.testConnection('conn_aws', 'org_1');

      expect(result.success).toBe(false);
      expect(result.message).toContain(pairArn);
      expect(result.message).toContain('does not require the External ID');
    });

    it('trims pasted AWS credential strings in place', () => {
      const credentials: Record<string, string | string[]> = {
        roleArn: '  arn:aws:iam::123456789012:role/OpenComp-Auditor  ',
        externalId: '  org_1-secret  ',
        remediationRoleArn:
          '  arn:aws:iam::123456789012:role/OpenComp-Remediator  ',
        remediationRoles: '  {"Storage:us-east-1":"arn:aws:iam::1:role/A"}  ',
        regions: ['us-east-1'],
      };

      trimAwsCredentialStrings(credentials);

      expect(credentials).toMatchObject({
        roleArn: 'arn:aws:iam::123456789012:role/OpenComp-Auditor',
        externalId: 'org_1-secret',
        remediationRoleArn:
          'arn:aws:iam::123456789012:role/OpenComp-Remediator',
        remediationRoles: '{"Storage:us-east-1":"arn:aws:iam::1:role/A"}',
      });
      // Non-string values pass through untouched.
      const withArrays: Record<string, string | string[]> = {
        regions: ['us-east-1'],
      };
      expect(() => trimAwsCredentialStrings(withArrays)).not.toThrow();
      expect(withArrays).toEqual({ regions: ['us-east-1'] });
    });

    it('stores trimmed credential strings when updating AWS credentials', async () => {
      // A pasted ARN with a trailing space must not reach the vault: STS
      // rejects it verbatim on every later scan.
      mockedGetManifest.mockReturnValue({
        auth: { type: 'api_key' },
        category: 'Cloud',
      } as never);

      await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: {
          roleArn: `  ${AUDITOR_ARN}  `,
          externalId: '  org_1-secret  ',
          remediationRoleArn: `  ${REMEDIATOR_ARN}  `,
        },
      });

      expect(
        mockCredentialVaultService.storeApiKeyCredentials,
      ).toHaveBeenCalledWith(
        'conn_aws',
        expect.objectContaining({
          roleArn: AUDITOR_ARN,
          externalId: 'org_1-secret',
          remediationRoleArn: REMEDIATOR_ARN,
        }),
      );
    });

    it('drops the synced pair map from metadata when it is cleared', async () => {
      mockedGetManifest.mockReturnValue({
        auth: { type: 'api_key' },
        category: 'Cloud',
      } as never);
      const stalePairs = {
        'Storage:us-east-1':
          'arn:aws:iam::123456789012:role/OpenComp-Remediator-Storage-us-east-1',
      };
      mockConnectionService.getConnectionForOrg.mockResolvedValue({
        id: 'conn_aws',
        organizationId: 'org_1',
        status: 'active',
        provider: { slug: 'aws' },
        metadata: { remediationRoles: stalePairs, regions: ['us-east-1'] },
      });
      mockCredentialVaultService.getDecryptedCredentials.mockResolvedValue(
        awsCredentials({
          remediationRoleArn: undefined,
          remediationRoles: JSON.stringify(stalePairs),
        }),
      );

      const result = await controller.updateCredentials('conn_aws', 'org_1', {
        credentials: { remediationRoles: '{}' },
      });

      expect(result).toEqual({ success: true });
      expect(mockConnectionRepository.update).toHaveBeenCalledWith('conn_aws', {
        metadata: expect.not.objectContaining({
          remediationRoles: expect.anything(),
        }),
      });
    });
  });
});
