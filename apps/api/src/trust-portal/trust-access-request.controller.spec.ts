import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { TrustAccessRequestController } from './trust-access-request.controller';
import { TrustAccessService } from './trust-access.service';
import {
  AccessRequestStatusFilter,
  ApproveAccessRequestDto,
  CreateAccessRequestDto,
  DenyAccessRequestDto,
  ListAccessRequestsDto,
  RevokeGrantDto,
} from './dto/trust-access.dto';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {
    trust: ['create', 'read', 'update', 'delete'],
  },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('TrustAccessRequestController', () => {
  let controller: TrustAccessRequestController;
  let service: jest.Mocked<TrustAccessService>;

  const mockService = {
    createAccessRequest: jest.fn(),
    listAccessRequests: jest.fn(),
    getAccessRequest: jest.fn(),
    approveRequest: jest.fn(),
    denyRequest: jest.fn(),
    listGrants: jest.fn(),
    revokeGrant: jest.fn(),
    resendAccessGrantEmail: jest.fn(),
    resendNda: jest.fn(),
    previewNda: jest.fn(),
    getMemberIdFromUserId: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const orgId = 'org_test123';

  const mockRequest = (userId?: string) =>
    ({
      userId,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'test-agent' },
    }) as unknown as Request;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustAccessRequestController],
      providers: [{ provide: TrustAccessService, useValue: mockService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<TrustAccessRequestController>(
      TrustAccessRequestController,
    );
    service = module.get(TrustAccessService);

    jest.clearAllMocks();
  });

  describe('createAccessRequest', () => {
    it('should call service.createAccessRequest with correct params', async () => {
      const dto: CreateAccessRequestDto = {
        name: 'Test User',
        email: 'user@example.com',
        company: 'Acme',
      };
      const req = mockRequest();
      mockService.createAccessRequest.mockResolvedValue({ id: 'req_1' });

      const result = await controller.createAccessRequest(
        'my-portal',
        dto,
        req,
      );

      expect(result).toEqual({ id: 'req_1' });
      expect(service.createAccessRequest).toHaveBeenCalledWith(
        'my-portal',
        dto,
        '127.0.0.1',
        'test-agent',
      );
    });
  });

  describe('listAccessRequests', () => {
    it('should call service.listAccessRequests with organizationId and dto', async () => {
      const dto: ListAccessRequestsDto = {
        status: AccessRequestStatusFilter.APPROVED,
      };
      const mockResult = { data: [{ id: 'req_1' }], count: 1 };
      mockService.listAccessRequests.mockResolvedValue(mockResult);

      const result = await controller.listAccessRequests(orgId, dto);

      expect(result).toEqual(mockResult);
      expect(service.listAccessRequests).toHaveBeenCalledWith(orgId, dto);
    });
  });

  describe('getAccessRequest', () => {
    it('should call service.getAccessRequest with organizationId and requestId', async () => {
      const mockResult = { id: 'req_1', email: 'user@example.com' };
      mockService.getAccessRequest.mockResolvedValue(mockResult);

      const result = await controller.getAccessRequest(orgId, 'req_1');

      expect(result).toEqual(mockResult);
      expect(service.getAccessRequest).toHaveBeenCalledWith(orgId, 'req_1');
    });
  });

  describe('approveRequest', () => {
    it('should call service.approveRequest with correct params', async () => {
      const dto: ApproveAccessRequestDto = { durationDays: 30 };
      const req = mockRequest('user_1');
      mockService.getMemberIdFromUserId.mockResolvedValue('mem_1');
      mockService.approveRequest.mockResolvedValue({ success: true });

      const result = await controller.approveRequest(orgId, 'req_1', dto, req);

      expect(result).toEqual({ success: true });
      expect(service.getMemberIdFromUserId).toHaveBeenCalledWith(
        'user_1',
        orgId,
      );
      expect(service.approveRequest).toHaveBeenCalledWith(
        orgId,
        'req_1',
        dto,
        'mem_1',
      );
    });

    it('should throw UnauthorizedException when userId is missing', async () => {
      const dto: ApproveAccessRequestDto = { durationDays: 30 };
      const req = mockRequest(undefined);

      await expect(
        controller.approveRequest(orgId, 'req_1', dto, req),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('denyRequest', () => {
    it('should call service.denyRequest with correct params', async () => {
      const dto: DenyAccessRequestDto = { reason: 'Not eligible' };
      const req = mockRequest('user_1');
      mockService.getMemberIdFromUserId.mockResolvedValue('mem_1');
      mockService.denyRequest.mockResolvedValue({ success: true });

      const result = await controller.denyRequest(orgId, 'req_1', dto, req);

      expect(result).toEqual({ success: true });
      expect(service.getMemberIdFromUserId).toHaveBeenCalledWith(
        'user_1',
        orgId,
      );
      expect(service.denyRequest).toHaveBeenCalledWith(
        orgId,
        'req_1',
        dto,
        'mem_1',
      );
    });

    it('should throw UnauthorizedException when userId is missing', async () => {
      const dto: DenyAccessRequestDto = { reason: 'test' };
      const req = mockRequest(undefined);

      await expect(
        controller.denyRequest(orgId, 'req_1', dto, req),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('listGrants', () => {
    it('should call service.listGrants with organizationId', async () => {
      const mockResult = [{ id: 'grant_1' }];
      mockService.listGrants.mockResolvedValue(mockResult);

      const result = await controller.listGrants(orgId);

      expect(result).toEqual(mockResult);
      expect(service.listGrants).toHaveBeenCalledWith(orgId);
    });
  });

  describe('revokeGrant', () => {
    it('should call service.revokeGrant with correct params', async () => {
      const dto: RevokeGrantDto = { reason: 'Revoked' };
      const req = mockRequest('user_1');
      mockService.getMemberIdFromUserId.mockResolvedValue('mem_1');
      mockService.revokeGrant.mockResolvedValue({ success: true });

      const result = await controller.revokeGrant(orgId, 'grant_1', dto, req);

      expect(result).toEqual({ success: true });
      expect(service.getMemberIdFromUserId).toHaveBeenCalledWith(
        'user_1',
        orgId,
      );
      expect(service.revokeGrant).toHaveBeenCalledWith(
        orgId,
        'grant_1',
        dto,
        'mem_1',
      );
    });

    it('should throw UnauthorizedException when userId is missing', async () => {
      const dto: RevokeGrantDto = { reason: 'test' };
      const req = mockRequest(undefined);

      await expect(
        controller.revokeGrant(orgId, 'grant_1', dto, req),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resendNda', () => {
    it('should call service.resendNda with organizationId and requestId', async () => {
      mockService.resendNda.mockResolvedValue({ success: true });

      const result = await controller.resendNda(orgId, 'req_1');

      expect(result).toEqual({ success: true });
      expect(service.resendNda).toHaveBeenCalledWith(orgId, 'req_1');
    });
  });

  describe('previewNda', () => {
    it('should call service.previewNda with organizationId and requestId', async () => {
      const mockResult = { url: 'https://preview-url' };
      mockService.previewNda.mockResolvedValue(mockResult);

      const result = await controller.previewNda(orgId, 'req_1');

      expect(result).toEqual(mockResult);
      expect(service.previewNda).toHaveBeenCalledWith(orgId, 'req_1');
    });
  });
});
