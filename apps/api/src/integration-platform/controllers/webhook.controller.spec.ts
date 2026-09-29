import { HttpStatus } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { db } from '@db';
import { WebhookController } from './webhook.controller';
import { ConnectionRepository } from '../repositories/connection.repository';
import { getManifest } from '@gideon-defender/integration-platform';

jest.mock('@db', () => ({
  db: {
    integrationRun: { create: jest.fn() },
    integrationPlatformFinding: { createMany: jest.fn() },
  },
  Prisma: {},
}));

jest.mock('@gideon-defender/integration-platform', () => ({
  getManifest: jest.fn(),
}));

const mockedGetManifest = getManifest as jest.MockedFunction<
  typeof getManifest
>;

function unsignedManifest(): unknown {
  return {
    capabilities: ['webhook'],
    // No secretHeader / signatureAlgorithm: deliveries cannot be verified.
    webhook: { path: '/hook', events: ['push'] },
  };
}

function signedManifest(): unknown {
  return {
    capabilities: ['webhook'],
    webhook: {
      path: '/hook',
      events: ['push'],
      secretHeader: 'x-provider-signature',
      signatureAlgorithm: 'sha256',
    },
  };
}

function controllerWith(connection: unknown): {
  controller: WebhookController;
  repo: { findById: jest.Mock };
} {
  const repo = { findById: jest.fn().mockResolvedValue(connection) };
  const controller = new WebhookController(
    repo as unknown as ConnectionRepository,
  );
  return { controller, repo };
}

describe('WebhookController signature enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.integrationRun.create as unknown as jest.Mock).mockResolvedValue({
      id: 'run_1',
    });
  });

  it('rejects an unsigned delivery when the provider has no signature config', async () => {
    mockedGetManifest.mockReturnValue(unsignedManifest() as never);
    const { controller } = controllerWith({
      id: 'conn_1',
      status: 'active',
      metadata: {},
    });

    const rawBody = Buffer.from(JSON.stringify({ event: 'push' }));
    await expect(
      controller.handleWebhook(
        'github',
        'conn_1',
        {},
        { event: 'push' },
        rawBody as never,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(db.integrationRun.create).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed delivery when the provider is configured', async () => {
    mockedGetManifest.mockReturnValue(signedManifest() as never);
    const secret = 'whsec_provider';
    const { controller } = controllerWith({
      id: 'conn_1',
      status: 'active',
      metadata: { webhookSecret: secret },
    });

    const rawBody = Buffer.from(JSON.stringify({ event: 'push' }));
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const result = await controller.handleWebhook(
      'github',
      'conn_1',
      { 'x-provider-signature': signature },
      { event: 'push' },
      { rawBody } as never,
    );

    expect(result).toEqual({ success: true });
    expect(db.integrationRun.create).toHaveBeenCalled();
  });

  it('rejects a wrong signature when the provider is configured', async () => {
    mockedGetManifest.mockReturnValue(signedManifest() as never);
    const { controller } = controllerWith({
      id: 'conn_1',
      status: 'active',
      metadata: { webhookSecret: 'whsec_provider' },
    });

    const rawBody = Buffer.from(JSON.stringify({ event: 'push' }));
    await expect(
      controller.handleWebhook(
        'github',
        'conn_1',
        { 'x-provider-signature': 'deadbeef' },
        { event: 'push' },
        { rawBody } as never,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
    expect(db.integrationRun.create).not.toHaveBeenCalled();
  });
});
