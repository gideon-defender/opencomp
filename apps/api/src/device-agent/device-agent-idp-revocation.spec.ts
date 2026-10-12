import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { revokeSsoMember } from '../auth/sso-member-sync';
import { DeviceAgentAuthService } from './device-agent-auth.service';

jest.mock('@db', () => ({
  db: {
    member: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    device: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    session: { delete: jest.fn() },
  },
}));
jest.mock('../auth/native-session.service', () => ({
  NativeSessionService: jest.fn(),
}));
jest.mock('./device-agent-kv', () => ({ deviceAgentRedisClient: {} }));
jest.mock('./device-registration.helpers', () => ({
  registerWithSerial: jest.fn(),
  registerWithoutSerial: jest.fn().mockResolvedValue({ id: 'dev_1' }),
}));
jest.mock('./device-agent-session.helper', () => ({
  createDeviceAgentSession: jest
    .fn()
    .mockResolvedValue({ sessionId: 'ses_new', token: 'token_new' }),
}));

const { db } = jest.requireMock<{
  db: {
    member: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    device: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    session: { delete: jest.Mock };
  };
}>('@db');
const { createDeviceAgentSession } = jest.requireMock<{
  createDeviceAgentSession: jest.Mock;
}>('./device-agent-session.helper');
const { registerWithoutSerial } = jest.requireMock<{
  registerWithoutSerial: jest.Mock;
}>('./device-registration.helpers');

type MemberFilter = {
  userId?: string;
  organizationId?: string;
  deactivated?: boolean;
  idpAccessRevoked?: boolean;
};
function membership(organizationId: string) {
  return {
    id: `mem_${organizationId}`,
    userId: 'usr_1',
    organizationId,
    role: 'employee',
    roleSource: 'sso',
    deactivated: false,
    idpAccessRevoked: false,
    organization: {
      id: organizationId,
      name: organizationId,
      slug: organizationId,
    },
  };
}
function device(organizationId: string) {
  return {
    id: `dev_${organizationId}`,
    organizationId,
    agentSessionId: 'ses_existing',
    diskEncryptionEnabled: true,
    antivirusEnabled: true,
    passwordPolicySet: true,
    screenLockEnabled: true,
    checkDetails: {},
  };
}

describe('device access after IdP revocation', () => {
  const service = new DeviceAgentAuthService();
  let members: ReturnType<typeof membership>[];
  let devices: ReturnType<typeof device>[];

  function matches({
    member,
    where,
  }: {
    member: ReturnType<typeof membership>;
    where: MemberFilter;
  }) {
    return Object.entries(where).every(
      ([field, value]) => Reflect.get(member, field) === value,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    members = ['org_1', 'org_2'].map(membership);
    devices = ['org_1', 'org_2'].map(device);
    db.member.findFirst.mockImplementation(
      async ({ where }: { where: MemberFilter }) =>
        members.find((member) => matches({ member, where })) ?? null,
    );
    db.member.findMany.mockImplementation(
      async ({ where }: { where: MemberFilter }) =>
        members.filter((member) => matches({ member, where })),
    );
    db.member.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: MemberFilter;
        data: { role: string; roleSource: string; idpAccessRevoked: boolean };
      }) => {
        const affected = members.filter((member) => matches({ member, where }));
        affected.forEach((member) => Object.assign(member, data));
        return { count: affected.length };
      },
    );
    function matchingDevices({
      where,
    }: {
      where: { id?: string; organizationId?: string; member: MemberFilter };
    }) {
      return devices.filter(
        (candidate) =>
          (!where.id || candidate.id === where.id) &&
          (!where.organizationId ||
            candidate.organizationId === where.organizationId) &&
          members.some(
            (member) =>
              member.organizationId === candidate.organizationId &&
              matches({ member, where: where.member }),
          ),
      );
    }
    db.device.findMany.mockImplementation(async (query) =>
      matchingDevices(query),
    );
    db.device.findFirst.mockImplementation(
      async (query) => matchingDevices(query)[0] ?? null,
    );
  });

  async function revoke() {
    await revokeSsoMember({ userId: 'usr_1', organizationId: 'org_1' });
  }

  it('rejects registration with an existing session after revocation', async () => {
    const request = {
      userId: 'usr_1',
      sessionId: 'ses_existing',
      dto: {
        name: 'Laptop',
        hostname: 'laptop',
        platform: 'macos' as const,
        osVersion: '15',
        organizationId: 'org_1',
      },
    };
    await expect(service.registerDevice(request)).resolves.toEqual({
      deviceId: 'dev_1',
    });
    await revoke();
    jest.clearAllMocks();
    await expect(service.registerDevice(request)).rejects.toThrow(
      ForbiddenException,
    );
    expect(registerWithoutSerial).not.toHaveBeenCalled();
    expect(db.device.update).not.toHaveBeenCalled();
    expect(db.session.delete).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'rejects check-in after revocation (agent session: %s)',
    async (sessionDeviceAgent) => {
      const request = {
        userId: 'usr_1',
        sessionId: 'ses_existing',
        sessionDeviceAgent,
        dto: { deviceId: 'dev_org_1', checks: [] },
      };
      await expect(service.checkIn(request)).resolves.toMatchObject({
        isCompliant: true,
      });
      await revoke();
      jest.clearAllMocks();
      await expect(service.checkIn(request)).rejects.toThrow(NotFoundException);
      expect(db.device.update).not.toHaveBeenCalled();
      expect(db.session.delete).not.toHaveBeenCalled();
      expect(createDeviceAgentSession).not.toHaveBeenCalled();
    },
  );

  it('hides revoked organizations and devices, and rejects direct device status', async () => {
    await revoke();
    await expect(
      service.getMyOrganizations({ userId: 'usr_1' }),
    ).resolves.toEqual({
      organizations: [
        {
          organizationId: 'org_2',
          organizationName: 'org_2',
          organizationSlug: 'org_2',
          role: 'employee',
        },
      ],
    });
    await expect(
      service.getDeviceStatus({ userId: 'usr_1', organizationId: 'org_1' }),
    ).resolves.toEqual({ devices: [] });
    await expect(service.getDeviceStatus({ userId: 'usr_1' })).resolves.toEqual(
      { devices: [devices[1]] },
    );
    await expect(
      service.getDeviceStatus({ userId: 'usr_1', deviceId: 'dev_org_1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('preserves employee device access in another tenant', async () => {
    await revoke();
    await expect(
      service.registerDevice({
        userId: 'usr_1',
        sessionId: 'ses_existing',
        dto: {
          name: 'Laptop',
          hostname: 'laptop',
          platform: 'macos',
          osVersion: '15',
          organizationId: 'org_2',
        },
      }),
    ).resolves.toEqual({ deviceId: 'dev_1' });
    await expect(
      service.checkIn({
        userId: 'usr_1',
        sessionId: 'ses_existing',
        sessionDeviceAgent: true,
        dto: { deviceId: 'dev_org_2', checks: [] },
      }),
    ).resolves.toMatchObject({ isCompliant: true });
    await expect(
      service.getDeviceStatus({ userId: 'usr_1', deviceId: 'dev_org_2' }),
    ).resolves.toEqual({ device: devices[1] });
  });
});
