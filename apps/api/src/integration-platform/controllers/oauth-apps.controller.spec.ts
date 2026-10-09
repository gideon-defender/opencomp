import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OAuthAppsController } from './oauth-apps.controller';
import { OAuthCredentialsService } from '../services/oauth-credentials.service';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { CredentialVaultService } from '../services/credential-vault.service';
import { HybridAuthGuard } from '../../auth/hybrid-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { SaveOAuthAppDto } from '../dto/save-oauth-app.dto';

jest.mock('@db', () => ({ db: {} }));
jest.mock('../../auth/hybrid-auth.guard', () => ({
  HybridAuthGuard: class HybridAuthGuard {},
}));
jest.mock('../../auth/permission.guard', () => ({
  PermissionGuard: class PermissionGuard {},
}));
jest.mock('@gideon-defender/integration-platform', () => ({
  getManifest: () => ({ auth: { type: 'oauth2', config: { scopes: [] } } }),
}));

describe('Organization OAuth settings', () => {
  const upsert = jest.fn();
  const encrypt = jest.fn(async (value: string) => ({ encrypted: value }));
  let controller: OAuthAppsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [OAuthAppsController],
      providers: [
        OAuthCredentialsService,
        { provide: OAuthAppRepository, useValue: { upsert } },
        { provide: PlatformCredentialRepository, useValue: {} },
        { provide: CredentialVaultService, useValue: { encrypt } },
      ],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(OAuthAppsController);
  });

  const body = {
    providerSlug: 'azure',
    clientId: 'client',
    clientSecret: 'secret',
    customScopes: ['openid'],
    customSettings: { tenantId: '55639f13-71b7-432d-b4e7-4efda934446d' },
  };

  it('persists the tenant with organization credentials', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const validated: SaveOAuthAppDto = await pipe.transform(body, {
      type: 'body',
      metatype: SaveOAuthAppDto,
    });
    await controller.saveOAuthApp('org_1', validated);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        customSettings: body.customSettings,
        customScopes: ['openid'],
      }),
    );
  });

  it('keeps tenant settings optional for existing clients', async () => {
    await controller.saveOAuthApp('org_1', {
      providerSlug: 'azure',
      clientId: 'client',
      clientSecret: 'secret',
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        customSettings: undefined,
      }),
    );
  });

  it.each(['tenant', ['tenant'], 123])(
    'rejects non-object settings %p',
    async (customSettings) => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      await expect(
        pipe.transform(
          { ...body, customSettings },
          {
            type: 'body',
            metatype: SaveOAuthAppDto,
          },
        ),
      ).rejects.toThrow();
    },
  );

  it('rejects invalid Azure tenants before encrypting or saving', async () => {
    const invalidBody = {
      ...body,
      customSettings: { tenantId: '../consumers' },
    };
    await expect(controller.saveOAuthApp('org_1', invalidBody)).rejects.toThrow(
      'must be a UUID',
    );
    expect(encrypt).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
