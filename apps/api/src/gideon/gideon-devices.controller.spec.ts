process.env.SECRET_KEY =
  process.env.SECRET_KEY || 'test-secret-key-16-chars-min';

import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { GideonDevicesProxyController } from './gideon-devices.controller';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn(), getMcpSession: jest.fn() } },
}));
jest.mock('../auth/hybrid-auth.guard');
jest.mock('../auth/permission.guard');

describe('GideonDevicesProxyController', () => {
  let controller: GideonDevicesProxyController;
  const OLD_ENV = process.env;

  const mockRes = () => {
    const res: Record<string, jest.Mock> = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return res as unknown as {
      status: jest.Mock;
      json: jest.Mock;
      setHeader: jest.Mock;
      send: jest.Mock;
    };
  };

  const mockReq = (overrides: Record<string, unknown> = {}) =>
    ({
      headers: {},
      query: {},
      ...overrides,
    }) as unknown as Parameters<
      GideonDevicesProxyController['proxyListDevices']
    >[0];

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV };
    delete process.env.GIDEON_DEVICES_PROXY_ENABLED;
    delete process.env.GIDEON_AGENT_COMMS_URL;
    delete process.env.AGENT_COMMS_URL;
    delete process.env.GIDEON_SHADOW_ENABLED;

    const module = await Test.createTestingModule({
      controllers: [GideonDevicesProxyController],
      providers: [Reflector],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GideonDevicesProxyController);
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('returns 404 shadow hint when GIDEON_DEVICES_PROXY_ENABLED!=true', async () => {
    const req = mockReq();
    const res = mockRes();
    await controller.proxyListDevices(req, res as never, undefined, undefined);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        shadow: true,
        message: expect.stringContaining('GIDEON_DEVICES_PROXY_ENABLED'),
      }),
    );
  });

  it('defaults agentCommsUrl to http://localhost:8080 (not 8082)', async () => {
    process.env.GIDEON_DEVICES_PROXY_ENABLED = 'true';
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ data: [] }),
    });
    global.fetch = fetchMock;

    const req = mockReq({ headers: { authorization: 'Bearer tok' } });
    const res = mockRes();
    await controller.proxyListDevices(req, res as never, '10', '0');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:8080/v1/admin/devices'),
      expect.any(Object),
    );
    expect(res.setHeader).toHaveBeenCalledWith('x-gideon-shadow', '1');
  });

  it('forwards Authorization, Cookie, x-gideon-tenant-id and query params', async () => {
    process.env.GIDEON_DEVICES_PROXY_ENABLED = 'true';
    process.env.GIDEON_AGENT_COMMS_URL = 'https://agent.example.com';
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{}',
    });
    global.fetch = fetchMock;

    const req = mockReq({
      headers: {
        authorization: 'Bearer jwt',
        cookie: 'a=b',
        'x-gideon-tenant-id': 'tid_1',
      },
      query: { limit: '5', foo: 'bar' },
    });
    const res = mockRes();
    await controller.proxyListDevices(req, res as never, undefined, undefined);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://agent.example.com/v1/admin/devices'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer jwt',
          cookie: 'a=b',
          'x-gideon-tenant-id': 'tid_1',
        }),
      }),
    );
  });

  it('returns 502 on upstream failure', async () => {
    process.env.GIDEON_DEVICES_PROXY_ENABLED = 'true';
    global.fetch = jest.fn().mockRejectedValue(new Error('upstream down'));

    const req = mockReq({ headers: { authorization: 'Bearer tok' } });
    const res = mockRes();
    await controller.proxyListDevices(req, res as never, undefined, undefined);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Agent Communications'),
      }),
    );
  });

  it('preserves upstream status and content-type', async () => {
    process.env.GIDEON_DEVICES_PROXY_ENABLED = 'true';
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      headers: {
        get: (k: string) => (k === 'content-type' ? 'application/json' : null),
      },
      text: async () => JSON.stringify({ ok: true }),
    });

    const req = mockReq({ headers: { authorization: 'Bearer tok' } });
    const res = mockRes();
    await controller.proxyListDevices(req, res as never, undefined, undefined);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith(
      'content-type',
      'application/json',
    );
  });
});
