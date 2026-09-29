import { BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { TrustRequestModerationService } from './trust-request-moderation.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findFirst: jest.fn(), update: jest.fn() },
    member: { findFirst: jest.fn() },
    trustNDAAgreement: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findFirst: jest.Mock; update: jest.Mock };
  member: { findFirst: jest.Mock };
  trustNDAAgreement: { updateMany: jest.Mock };
  auditLog: { create: jest.Mock };
};

function activeGrant() {
  return {
    id: 'grant_1',
    status: 'active',
    subjectEmail: 'ada@company.com',
    accessRequest: { organizationId: 'org_1' },
  };
}

function reviewer() {
  return { id: 'member_1', userId: 'user_1' };
}

function createService() {
  return new TrustRequestModerationService();
}

describe('TrustRequestModerationService.revokeGrant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(activeGrant());
    mockDb.trustAccessGrant.update.mockImplementation(
      (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<Record<string, unknown>> =>
        Promise.resolve({ ...activeGrant(), ...args.data }),
    );
    mockDb.member.findFirst.mockResolvedValue(reviewer());
    mockDb.trustNDAAgreement.updateMany.mockResolvedValue({ count: 1 });
    mockDb.auditLog.create.mockResolvedValue({});
  });

  it('throws NotFound when the grant does not belong to the organization', async () => {
    mockDb.trustAccessGrant.findFirst.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.revokeGrant(
        'org_1',
        'grant_missing',
        { reason: 'left' },
        'member_1',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(mockDb.trustAccessGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'grant_missing',
          accessRequest: { organizationId: 'org_1' },
        }),
      }),
    );
  });

  it('throws BadRequest when the grant is already revoked', async () => {
    mockDb.trustAccessGrant.findFirst.mockResolvedValue({
      ...activeGrant(),
      status: 'revoked',
    });
    const service = createService();

    await expect(
      service.revokeGrant('org_1', 'grant_1', { reason: 'again' }, 'member_1'),
    ).rejects.toThrow('Grant is already revoked');
  });

  it('throws BadRequest when the reviewer member is unknown', async () => {
    mockDb.member.findFirst.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.revokeGrant(
        'org_1',
        'grant_1',
        { reason: 'left' },
        'member_unknown',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequest when no reviewer member is given', async () => {
    const service = createService();

    await expect(
      service.revokeGrant('org_1', 'grant_1', { reason: 'left' }),
    ).rejects.toThrow('Invalid member ID');
  });

  it('revokes the grant, voids the NDA, and writes an audit log', async () => {
    const service = createService();

    const result = await service.revokeGrant(
      'org_1',
      'grant_1',
      { reason: 'contractor left' },
      'member_1',
    );

    expect(result.status).toBe('revoked');
    expect(mockDb.trustAccessGrant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grant_1' },
        data: expect.objectContaining({
          status: 'revoked',
          revokedByMemberId: 'member_1',
          revokeReason: 'contractor left',
        }),
      }),
    );
    expect(mockDb.trustNDAAgreement.updateMany).toHaveBeenCalledWith({
      where: { grantId: 'grant_1' },
      data: { status: 'void' },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org_1',
          userId: 'user_1',
          memberId: 'member_1',
          entityType: 'trust',
          entityId: 'grant_1',
        }),
      }),
    );
  });
});
