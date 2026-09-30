import { Test, TestingModule } from '@nestjs/testing';
import { TrustAccessGrantController } from './trust-access-grant.controller';
import { TrustAccessService } from './trust-access.service';
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

describe('TrustAccessGrantController', () => {
  let controller: TrustAccessGrantController;
  let service: jest.Mocked<TrustAccessService>;

  const mockService = {
    getPoliciesByAccessToken: jest.fn(),
    downloadAllPoliciesByAccessToken: jest.fn(),
    downloadAllPoliciesAsZipByAccessToken: jest.fn(),
    getComplianceResourcesByAccessToken: jest.fn(),
    getTrustDocumentsByAccessToken: jest.fn(),
    downloadAllTrustDocumentsByAccessToken: jest.fn(),
    getTrustDocumentUrlByAccessToken: jest.fn(),
    getComplianceResourceUrlByAccessToken: jest.fn(),
    getCustomComplianceResourceUrlByAccessToken: jest.fn(),
    downloadPolicyByAccessToken: jest.fn(),
    resendAccessGrantEmail: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const orgId = 'org_test123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustAccessGrantController],
      providers: [{ provide: TrustAccessService, useValue: mockService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<TrustAccessGrantController>(
      TrustAccessGrantController,
    );
    service = module.get(TrustAccessService);

    jest.clearAllMocks();
  });

  describe('getPoliciesByAccessToken', () => {
    it('should call service.getPoliciesByAccessToken with token', async () => {
      const mockResult = [{ id: 'pol_1', name: 'Privacy Policy' }];
      mockService.getPoliciesByAccessToken.mockResolvedValue(mockResult);

      const result = await controller.getPoliciesByAccessToken('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.getPoliciesByAccessToken).toHaveBeenCalledWith(
        'token_abc',
      );
    });
  });

  describe('downloadAllPolicies', () => {
    it('should call service.downloadAllPoliciesByAccessToken with token', async () => {
      const mockResult = { url: 'https://download-url' };
      mockService.downloadAllPoliciesByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result = await controller.downloadAllPolicies('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.downloadAllPoliciesByAccessToken).toHaveBeenCalledWith(
        'token_abc',
      );
    });
  });

  describe('downloadAllPoliciesAsZip', () => {
    it('should call service.downloadAllPoliciesAsZipByAccessToken with token', async () => {
      const mockResult = { url: 'https://zip-url' };
      mockService.downloadAllPoliciesAsZipByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result = await controller.downloadAllPoliciesAsZip('token_abc');

      expect(result).toEqual(mockResult);
      expect(
        service.downloadAllPoliciesAsZipByAccessToken,
      ).toHaveBeenCalledWith('token_abc');
    });
  });

  describe('getComplianceResourcesByAccessToken', () => {
    it('should call service.getComplianceResourcesByAccessToken with token', async () => {
      const mockResult = [{ id: 'cr_1' }];
      mockService.getComplianceResourcesByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result =
        await controller.getComplianceResourcesByAccessToken('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.getComplianceResourcesByAccessToken).toHaveBeenCalledWith(
        'token_abc',
      );
    });
  });

  describe('getTrustDocumentsByAccessToken', () => {
    it('should call service.getTrustDocumentsByAccessToken with token', async () => {
      const mockResult = [{ id: 'td_1' }];
      mockService.getTrustDocumentsByAccessToken.mockResolvedValue(mockResult);

      const result =
        await controller.getTrustDocumentsByAccessToken('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.getTrustDocumentsByAccessToken).toHaveBeenCalledWith(
        'token_abc',
      );
    });
  });

  describe('downloadAllTrustDocuments', () => {
    it('should call service.downloadAllTrustDocumentsByAccessToken with token', async () => {
      const mockResult = { url: 'https://zip-url' };
      mockService.downloadAllTrustDocumentsByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result = await controller.downloadAllTrustDocuments('token_abc');

      expect(result).toEqual(mockResult);
      expect(
        service.downloadAllTrustDocumentsByAccessToken,
      ).toHaveBeenCalledWith('token_abc');
    });
  });

  describe('getTrustDocumentUrlByAccessToken', () => {
    it('should call service with token and documentId', async () => {
      const mockResult = { url: 'https://signed-url' };
      mockService.getTrustDocumentUrlByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result = await controller.getTrustDocumentUrlByAccessToken(
        'token_abc',
        'tdoc_1',
      );

      expect(result).toEqual(mockResult);
      expect(service.getTrustDocumentUrlByAccessToken).toHaveBeenCalledWith(
        'token_abc',
        'tdoc_1',
      );
    });
  });

  describe('getComplianceResourceUrlByAccessToken', () => {
    it('should call service with token and framework', async () => {
      const mockResult = { url: 'https://signed-url' };
      mockService.getComplianceResourceUrlByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result = await controller.getComplianceResourceUrlByAccessToken(
        'token_abc',
        'SOC2',
      );

      expect(result).toEqual(mockResult);
      expect(
        service.getComplianceResourceUrlByAccessToken,
      ).toHaveBeenCalledWith('token_abc', 'SOC2');
    });
  });

  describe('getCustomComplianceResourceUrlByAccessToken', () => {
    it('should call service with token and customFrameworkId', async () => {
      const mockResult = { url: 'https://signed-url' };
      mockService.getCustomComplianceResourceUrlByAccessToken.mockResolvedValue(
        mockResult,
      );

      const result =
        await controller.getCustomComplianceResourceUrlByAccessToken(
          'token_abc',
          'cfrm_1',
        );

      expect(result).toEqual(mockResult);
      expect(
        service.getCustomComplianceResourceUrlByAccessToken,
      ).toHaveBeenCalledWith('token_abc', 'cfrm_1');
    });
  });

  describe('downloadPolicy', () => {
    it('should call service with token and policyId', async () => {
      const mockResult = { url: 'https://signed-url' };
      mockService.downloadPolicyByAccessToken.mockResolvedValue(mockResult);

      const result = await controller.downloadPolicy('token_abc', 'pol_1');

      expect(result).toEqual(mockResult);
    });
  });

  describe('resendAccessEmail', () => {
    it('should call service.resendAccessGrantEmail with organizationId and grantId', async () => {
      mockService.resendAccessGrantEmail.mockResolvedValue({ success: true });

      const result = await controller.resendAccessEmail(orgId, 'grant_1');

      expect(result).toEqual({ success: true });
      expect(service.resendAccessGrantEmail).toHaveBeenCalledWith(
        orgId,
        'grant_1',
      );
    });
  });
});
