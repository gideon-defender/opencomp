import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import request from 'supertest';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';

describe('OIDC callback diagnostic logging', () => {
  it('logs safe nested validation details and preserves the failure redirect', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const oldIssuer = process.env.OIDC_ISSUER_URL;
    const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.OIDC_ISSUER_URL = 'https://api.dev.gideondefender.com';
    process.env.NEXT_PUBLIC_APP_URL = 'https://opencomp.dev.gideondefender.com';
    const module = await Test.createTestingModule({
      controllers: [OidcController],
      providers: [
        {
          provide: OidcService,
          useValue: {
            peekStoredRedirect: jest.fn().mockResolvedValue(undefined),
            handleCallback: jest.fn().mockRejectedValue({
              message: 'invalid response encountered',
              cause: {
                message: 'unexpected "iss" (issuer) response parameter value',
                cause: { access_token: 'SECRET_TOKEN' },
              },
            }),
          },
        },
      ],
    }).compile();
    try {
      const controller = module.get(OidcController);
      const app = express();
      app.get('/callback', (req, res) => controller.callback({}, req, res));
      await request(app)
        .get('/callback')
        .query({
          code: 'SECRET_CODE',
          state: 'SECRET_STATE',
          iss: 'https://tenant.example.com',
        })
        .expect(302)
        .expect(
          'Location',
          'https://opencomp.dev.gideondefender.com/auth?error=oidc_login_failed',
        );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'oidc_callback_failed',
          issuerOrigin: 'https://tenant.example.com',
          issuerMatchesExpected: false,
          reasons: [
            'invalid response encountered',
            'unexpected "iss" (issuer) response parameter value',
          ],
        }),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
      if (oldIssuer === undefined) delete process.env.OIDC_ISSUER_URL;
      else process.env.OIDC_ISSUER_URL = oldIssuer;
      if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
      await module.close();
    }
  });
});
