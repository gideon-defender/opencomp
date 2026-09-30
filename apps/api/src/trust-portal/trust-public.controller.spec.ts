import { Test, TestingModule } from '@nestjs/testing';
import { TrustPublicController } from './trust-public.controller';
import { TrustPublicService } from './trust-public.service';
import { TrustPublicCatalogService } from './trust-public-catalog.service';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {
    trust: ['create', 'read', 'update', 'delete'],
  },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('TrustPublicController', () => {
  let controller: TrustPublicController;
  let publicService: jest.Mocked<TrustPublicService>;
  let catalogService: jest.Mocked<TrustPublicCatalogService>;

  const mockPublicService = {
    getFaqs: jest.fn(),
    getPublicOverview: jest.fn(),
    getPublicSecurityQuestionnaireEnabled: jest.fn(),
    getPublicCustomLinks: jest.fn(),
    getPublicFavicon: jest.fn(),
    getPublicCustomFrameworks: jest.fn(),
    getPublicProfile: jest.fn(),
    getPublicPolicies: jest.fn(),
    getPublicControls: jest.fn(),
  };

  const mockCatalogService = {
    getPublicVendors: jest.fn(),
    getPublicFrameworks: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustPublicController],
      providers: [
        { provide: TrustPublicService, useValue: mockPublicService },
        { provide: TrustPublicCatalogService, useValue: mockCatalogService },
      ],
    }).compile();

    controller = module.get<TrustPublicController>(TrustPublicController);
    publicService = module.get(TrustPublicService);
    catalogService = module.get(TrustPublicCatalogService);

    jest.clearAllMocks();
  });

  describe('getFaqs', () => {
    it('should call publicService.getFaqs with friendlyUrl', async () => {
      const mockResult = { faqs: [{ question: 'Q1', answer: 'A1' }] };
      mockPublicService.getFaqs.mockResolvedValue(mockResult);

      const result = await controller.getFaqs('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getFaqs).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicOverview', () => {
    it('should call publicService.getPublicOverview with friendlyUrl', async () => {
      const mockResult = { title: 'Trust Center' };
      mockPublicService.getPublicOverview.mockResolvedValue(mockResult);

      const result = await controller.getPublicOverview('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicOverview).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicCustomLinks', () => {
    it('should call publicService.getPublicCustomLinks with friendlyUrl', async () => {
      const mockResult = [{ id: 'cl_1', title: 'Link' }];
      mockPublicService.getPublicCustomLinks.mockResolvedValue(mockResult);

      const result = await controller.getPublicCustomLinks('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicCustomLinks).toHaveBeenCalledWith(
        'my-portal',
      );
    });
  });

  describe('getPublicFavicon', () => {
    it('should call publicService.getPublicFavicon and return wrapped result', async () => {
      mockPublicService.getPublicFavicon.mockResolvedValue(
        'https://favicon-url',
      );

      const result = await controller.getPublicFavicon('my-portal');

      expect(result).toEqual({ faviconUrl: 'https://favicon-url' });
      expect(publicService.getPublicFavicon).toHaveBeenCalledWith('my-portal');
    });

    it('should return null faviconUrl when service returns null', async () => {
      mockPublicService.getPublicFavicon.mockResolvedValue(null);

      const result = await controller.getPublicFavicon('my-portal');

      expect(result).toEqual({ faviconUrl: null });
    });
  });

  describe('getPublicVendors', () => {
    it('should call catalogService.getPublicVendors with friendlyUrl', async () => {
      const mockResult = [{ id: 'v_1', name: 'Vendor' }];
      mockCatalogService.getPublicVendors.mockResolvedValue(mockResult);

      const result = await controller.getPublicVendors('my-portal');

      expect(result).toEqual(mockResult);
      expect(catalogService.getPublicVendors).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicSecurityQuestionnaire', () => {
    it('should wrap the enabled flag in an object', async () => {
      mockPublicService.getPublicSecurityQuestionnaireEnabled.mockResolvedValue(
        true,
      );

      const result =
        await controller.getPublicSecurityQuestionnaire('my-portal');

      expect(result).toEqual({ enabled: true });
      expect(
        publicService.getPublicSecurityQuestionnaireEnabled,
      ).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicCustomFrameworks', () => {
    it('should call publicService.getPublicCustomFrameworks', async () => {
      const mockResult = [{ id: 'cfrm_1', name: 'Custom' }];
      mockPublicService.getPublicCustomFrameworks.mockResolvedValue(mockResult);

      const result = await controller.getPublicCustomFrameworks('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicCustomFrameworks).toHaveBeenCalledWith(
        'my-portal',
      );
    });
  });

  describe('getPublicProfile', () => {
    it('should call publicService.getPublicProfile', async () => {
      const mockResult = { organizationName: 'Acme' };
      mockPublicService.getPublicProfile.mockResolvedValue(mockResult);

      const result = await controller.getPublicProfile('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicProfile).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicFrameworks', () => {
    it('should call catalogService.getPublicFrameworks', async () => {
      const mockResult = [{ key: 'soc2type2', title: 'SOC 2 Type 2' }];
      mockCatalogService.getPublicFrameworks.mockResolvedValue(mockResult);

      const result = await controller.getPublicFrameworks('my-portal');

      expect(result).toEqual(mockResult);
      expect(catalogService.getPublicFrameworks).toHaveBeenCalledWith(
        'my-portal',
      );
    });
  });

  describe('getPublicPolicies', () => {
    it('should call publicService.getPublicPolicies', async () => {
      const mockResult = [{ id: 'pol_1', name: 'Security' }];
      mockPublicService.getPublicPolicies.mockResolvedValue(mockResult);

      const result = await controller.getPublicPolicies('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicPolicies).toHaveBeenCalledWith('my-portal');
    });
  });

  describe('getPublicControls', () => {
    it('should call publicService.getPublicControls', async () => {
      const mockResult = [{ id: 'ctl_1', name: 'Encryption' }];
      mockPublicService.getPublicControls.mockResolvedValue(mockResult);

      const result = await controller.getPublicControls('my-portal');

      expect(result).toEqual(mockResult);
      expect(publicService.getPublicControls).toHaveBeenCalledWith('my-portal');
    });
  });
});
