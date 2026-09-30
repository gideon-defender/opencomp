import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { TrustNdaPreviewController } from './trust-nda-preview.controller';
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

describe('TrustNdaPreviewController', () => {
  let controller: TrustNdaPreviewController;
  let service: jest.Mocked<TrustAccessService>;

  const mockService = {
    previewNda: jest.fn(),
    getPreviewNdaPdfBuffer: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const orgId = 'org_test123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrustNdaPreviewController],
      providers: [{ provide: TrustAccessService, useValue: mockService }],
    })
      .overrideGuard(HybridAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(PermissionGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<TrustNdaPreviewController>(
      TrustNdaPreviewController,
    );
    service = module.get(TrustAccessService);

    jest.clearAllMocks();
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

  describe('streamPreviewNda', () => {
    it('should stream the preview PDF inline with download headers', async () => {
      const buffer = Buffer.from('pdf-bytes');
      mockService.getPreviewNdaPdfBuffer.mockResolvedValue({
        buffer,
        filename: 'nda_preview_req1.pdf',
      });
      const setHeader = jest.fn();
      const send = jest.fn();
      const res = { setHeader, send } as unknown as Response;

      await controller.streamPreviewNda(orgId, 'req_1', res);

      expect(service.getPreviewNdaPdfBuffer).toHaveBeenCalledWith(
        orgId,
        'req_1',
      );
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="nda_preview_req1.pdf"',
      );
      expect(setHeader).toHaveBeenCalledWith('Content-Length', buffer.length);
      expect(send).toHaveBeenCalledWith(buffer);
    });

    it('should propagate service errors without sending a response', async () => {
      mockService.getPreviewNdaPdfBuffer.mockRejectedValue(
        new NotFoundException('Access request not found'),
      );
      const setHeader = jest.fn();
      const send = jest.fn();
      const res = { setHeader, send } as unknown as Response;

      await expect(
        controller.streamPreviewNda(orgId, 'missing', res),
      ).rejects.toThrow(NotFoundException);
      expect(send).not.toHaveBeenCalled();
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
