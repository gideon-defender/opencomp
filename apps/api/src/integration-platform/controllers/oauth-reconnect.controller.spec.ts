import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import type { Request, Response as ExpressResponse } from 'express';
import { getManifest } from '@gideon-defender/integration-platform';
import { OAuthController } from './oauth.controller';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { SessionOnlyGuard } from '../../auth/session-only.guard';
import { OAuthReconnectGuard } from '../guards/oauth-reconnect.guard';
import { OAuthStateRepository } from '../repositories/oauth-state.repository';
import { ProviderRepository } from '../repositories/provider.repository';
import { ConnectionRepository } from '../repositories/connection.repository';
import { CredentialVaultService } from '../services/credential-vault.service';
import { ConnectionService } from '../services/connection.service';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { AutoCheckRunnerService } from '../services/auto-check-runner.service';

jest.mock('@db', () => ({ ...jest.requireActual('@prisma/client'), db: {} }));
jest.mock('../../auth/auth.server', () => ({
  auth: {
    api: {
      getSession: jest.fn().mockResolvedValue({
        user: { id: 'user_1' },
        session: { activeOrganizationId: 'org_1' },
      }),
    },
  },
}));
jest.mock('../../auth/hybrid-auth.guard', () => ({
  HybridAuthGuard: class {},
}));
jest.mock('../../auth/permission.guard', () => ({ PermissionGuard: class {} }));
jest.mock('../../auth/session-only.guard', () => ({
  SessionOnlyGuard: class {},
}));
jest.mock('../guards/oauth-reconnect.guard', () => ({
  OAuthReconnectGuard: class {},
}));
jest.mock('@gideon-defender/integration-platform', () => ({
  getManifest: jest.fn(),
}));

describe('OAuth reconnect target', () => {
  let controller: OAuthController;
  const states = {
    create: jest.fn(),
    findByState: jest.fn(),
    delete: jest.fn(),
  };
  const providers = { upsert: jest.fn(), findBySlug: jest.fn() };
  const connections = {
    findOAuthTarget: jest.fn(),
    findByProviderAndOrg: jest.fn(),
    update: jest.fn(),
  };
  const vault = { storeOAuthTokens: jest.fn() };
  const service = {
    createConnection: jest.fn(),
    activateConnection: jest.fn(),
  };
  const credentials = {
    getCredentials: jest.fn(),
    checkAvailability: jest.fn(),
  };
  const runner = { tryAutoRunChecks: jest.fn() };
  const selected = {
    id: 'older_connection',
    metadata: { accountId: 'original-account' },
  };
  const state = {
    state: 'server-state',
    providerSlug: 'azure',
    organizationId: 'org_1',
    userId: 'user_1',
    connectionId: selected.id,
    expiresAt: new Date(Date.now() + 600000),
    redirectUrl: null,
  };
  const request = { headers: { cookie: 'session' } } as unknown as Request;
  const response = { redirect: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(getManifest).mockReturnValue({
      id: 'azure',
      name: 'Azure',
      description: 'Azure cloud',
      logoUrl: '',
      category: 'Cloud',
      capabilities: [],
      isActive: true,
      auth: {
        type: 'oauth2',
        config: {
          authorizeUrl:
            'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
          tokenUrl:
            'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
          scopes: [],
          pkce: false,
          clientAuthMethod: 'body',
          supportsRefreshToken: true,
        },
      },
    });
    states.create.mockResolvedValue(state);
    states.findByState.mockResolvedValue(state);
    connections.findOAuthTarget.mockReset().mockResolvedValue(selected);
    connections.findByProviderAndOrg.mockResolvedValue({
      id: 'newest_connection',
    });
    connections.update.mockResolvedValue(selected);
    providers.findBySlug.mockResolvedValue({ id: 'azure_provider' });
    credentials.getCredentials.mockResolvedValue({
      clientId: 'client',
      clientSecret: 'secret',
      scopes: [],
    });
    runner.tryAutoRunChecks.mockResolvedValue(false);
    const module = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        { provide: OAuthStateRepository, useValue: states },
        { provide: ProviderRepository, useValue: providers },
        { provide: ConnectionRepository, useValue: connections },
        { provide: CredentialVaultService, useValue: vault },
        { provide: ConnectionService, useValue: service },
        { provide: OAuthCredentialsService, useValue: credentials },
        { provide: AutoCheckRunnerService, useValue: runner },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionOnlyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OAuthReconnectGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(OAuthController);
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates and stores the exact connection before starting authorization', async () => {
    await controller.startOAuth('org_1', 'user_1', {
      providerSlug: 'azure',
      connectionId: selected.id,
      organizationId: 'untrusted_org',
    });
    expect(connections.findOAuthTarget).toHaveBeenCalledWith({
      connectionId: selected.id,
      organizationId: 'org_1',
      providerSlug: 'azure',
    });
    expect(states.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: selected.id,
        organizationId: 'org_1',
      }),
    );
  });

  it('rejects targets outside the org/provider, non-OAuth or disconnected targets', async () => {
    connections.findOAuthTarget.mockResolvedValue(null);
    await expect(
      controller.startOAuth('org_1', 'user_1', {
        providerSlug: 'azure',
        connectionId: 'ineligible_connection',
      }),
    ).rejects.toThrow(HttpException);
    expect(states.create).not.toHaveBeenCalled();
    expect(credentials.getCredentials).not.toHaveBeenCalled();
  });

  it('replaces tokens on the selected older account, not the newest account', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
          { status: 200 },
        ),
      );
    await controller.oauthCallback(
      { code: 'code', state: state.state },
      request,
      response as unknown as ExpressResponse,
    );
    expect(connections.findByProviderAndOrg).not.toHaveBeenCalled();
    expect(service.createConnection).not.toHaveBeenCalled();
    expect(vault.storeOAuthTokens).toHaveBeenCalledWith(
      selected.id,
      expect.objectContaining({ access_token: 'access' }),
      expect.any(Object),
    );
    expect(connections.update).toHaveBeenCalledWith(selected.id, {
      metadata: {
        accountId: 'original-account',
        reconnectedAt: expect.any(String),
      },
    });
    expect(service.activateConnection).toHaveBeenCalledWith(selected.id);
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('success=true'),
    );
  });

  it.each(['before', 'during'])(
    'fails closed if the target disappears %s token exchange',
    async (when) => {
      if (when === 'before')
        connections.findOAuthTarget.mockResolvedValue(null);
      else
        connections.findOAuthTarget
          .mockResolvedValueOnce(selected)
          .mockResolvedValueOnce(null);
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        }),
      );
      await controller.oauthCallback(
        { code: 'code', state: state.state },
        request,
        response as unknown as ExpressResponse,
      );
      if (when === 'before') expect(fetchSpy).not.toHaveBeenCalled();
      expect(connections.findByProviderAndOrg).not.toHaveBeenCalled();
      expect(service.createConnection).not.toHaveBeenCalled();
      expect(vault.storeOAuthTokens).not.toHaveBeenCalled();
      expect(service.activateConnection).not.toHaveBeenCalled();
      expect(states.delete).toHaveBeenCalledWith(state.state);
      expect(response.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error=token_exchange_failed'),
      );
    },
  );
});
