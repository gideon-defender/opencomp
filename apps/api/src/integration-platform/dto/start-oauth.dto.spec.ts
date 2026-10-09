import { ValidationPipe } from '@nestjs/common';
import { StartOAuthDto } from './start-oauth.dto';

describe('StartOAuthDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const metadata = { type: 'body' as const, metatype: StartOAuthDto };

  it('accepts reconnect fields and legacy organizationId through the runtime pipe', async () => {
    const body = {
      providerSlug: 'azure',
      connectionId: 'conn_1',
      redirectUrl: 'https://app.example',
      organizationId: 'org_1',
    };
    await expect(pipe.transform(body, metadata)).resolves.toEqual(body);
  });

  it('accepts new authorization without connectionId', async () => {
    await expect(
      pipe.transform({ providerSlug: 'gcp' }, metadata),
    ).resolves.toEqual({ providerSlug: 'gcp' });
  });

  it.each(['', 42, {}])(
    'rejects an invalid connection ID: %p',
    async (connectionId) => {
      await expect(
        pipe.transform({ providerSlug: 'azure', connectionId }, metadata),
      ).rejects.toThrow();
    },
  );
});
