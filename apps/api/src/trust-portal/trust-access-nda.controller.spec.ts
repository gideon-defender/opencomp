import { Test, TestingModule } from '@nestjs/testing';
import { TrustAccessNdaController } from './trust-access-nda.controller';
import { TrustAccessService } from './trust-access.service';
import { ReclaimAccessDto } from './dto/trust-access.dto';

jest.mock('../auth/auth.server', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('@gideon-defender/auth', () => ({
  statement: {
    trust: ['create', 'read', 'update', 'delete'],
  },
  BUILT_IN_ROLE_PERMISSIONS: {},
}));

describe('TrustAccessNdaController', () => {
  let controller: TrustAccessNdaController;
  let service: jest.Mocked<TrustAccessService>;

  const mockService = {
    getNdaByToken: jest.fn(),
    previewNdaByToken: jest.fn(),
    signNda: jest.fn(),
    reclaimAccess: jest.fn(),
    getGrantByAccessToken: jest.fn(),
  };

  const mockRequest = (userId?: string) =>
    ({
      userId,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'test-agent' },
    }) as unknown as Request;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustAccessNdaController],
      providers: [{ provide: TrustAccessService, useValue: mockService }],
    }).compile();

    controller = module.get<TrustAccessNdaController>(TrustAccessNdaController);
    service = module.get(TrustAccessService);

    jest.clearAllMocks();
  });

  describe('getNda', () => {
    it('should call service.getNdaByToken with token', async () => {
      const mockResult = { id: 'nda_1', content: 'NDA content' };
      mockService.getNdaByToken.mockResolvedValue(mockResult);

      const result = await controller.getNda('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.getNdaByToken).toHaveBeenCalledWith('token_abc');
    });
  });

  describe('previewNdaByToken', () => {
    it('should call service.previewNdaByToken with token', async () => {
      const mockResult = { url: 'https://preview-url' };
      mockService.previewNdaByToken.mockResolvedValue(mockResult);

      const result = await controller.previewNdaByToken('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.previewNdaByToken).toHaveBeenCalledWith('token_abc');
    });
  });

  describe('signNda', () => {
    it('should call service.signNda with correct params when accepted', async () => {
      const dto = { accept: true, name: 'John', email: 'john@example.com' };
      const req = mockRequest();
      mockService.signNda.mockResolvedValue({ success: true });

      const result = await controller.signNda('token_abc', dto, req);

      expect(result).toEqual({ success: true });
      expect(service.signNda).toHaveBeenCalledWith(
        'token_abc',
        'John',
        'john@example.com',
        '127.0.0.1',
        'test-agent',
      );
    });

    it('should throw error when accept is false', async () => {
      const dto = { accept: false, name: 'John', email: 'john@example.com' };
      const req = mockRequest();

      await expect(controller.signNda('token_abc', dto, req)).rejects.toThrow(
        'You must accept the NDA to proceed',
      );
    });
  });

  describe('reclaimAccess', () => {
    it('should call service.reclaimAccess with friendlyUrl, email, and query', async () => {
      const dto: ReclaimAccessDto = { email: 'user@example.com' };
      mockService.reclaimAccess.mockResolvedValue({ success: true });

      const result = await controller.reclaimAccess(
        'my-portal',
        dto,
        'security-questionnaire',
      );

      expect(result).toEqual({ success: true });
      expect(service.reclaimAccess).toHaveBeenCalledWith(
        'my-portal',
        'user@example.com',
        'security-questionnaire',
      );
    });

    it('should pass undefined query when not provided', async () => {
      const dto = { email: 'user@example.com' };
      mockService.reclaimAccess.mockResolvedValue({ success: true });

      await controller.reclaimAccess('my-portal', dto);

      expect(service.reclaimAccess).toHaveBeenCalledWith(
        'my-portal',
        'user@example.com',
        undefined,
      );
    });
  });

  describe('getGrantByAccessToken', () => {
    it('should call service.getGrantByAccessToken with token', async () => {
      const mockResult = { id: 'grant_1', email: 'user@example.com' };
      mockService.getGrantByAccessToken.mockResolvedValue(mockResult);

      const result = await controller.getGrantByAccessToken('token_abc');

      expect(result).toEqual(mockResult);
      expect(service.getGrantByAccessToken).toHaveBeenCalledWith('token_abc');
    });
  });
});
