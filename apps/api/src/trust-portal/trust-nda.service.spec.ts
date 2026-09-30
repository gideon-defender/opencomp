import { BadRequestException, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantTokenService } from './trust-grant-token.service';
import { TrustNdaService } from './trust-nda.service';
import { TrustNdaPreviewService } from './trust-nda-preview.service';

jest.mock('@db', () => ({
  db: {
    trustNDAAgreement: { findUnique: jest.fn() },
    trustAccessRequest: { findFirst: jest.fn() },
  },
}));

const mockDb = db as unknown as {
  trustNDAAgreement: { findUnique: jest.Mock };
  trustAccessRequest: { findFirst: jest.Mock };
};

function ndaAgreement(status: string, expired: boolean) {
  const signTokenExpiresAt = expired
    ? new Date(Date.now() - 86_400_000)
    : new Date(Date.now() + 86_400_000);
  return { id: 'nda_1', status, signTokenExpiresAt };
}

function createService() {
  const previewService = new TrustNdaPreviewService(
    {} as unknown as NdaPdfService,
    {} as unknown as AttachmentsService,
  );
  const service = new TrustNdaService(
    {} as unknown as NdaPdfService,
    {} as unknown as TrustPublicService,
    {} as unknown as TrustGrantTokenService,
    previewService,
  );
  return service;
}

describe('TrustNdaService.previewNdaByToken state ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFound for an unknown token', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(null);

    await expect(createService().previewNdaByToken('bad')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reports signed instead of expired for a signed past-window NDA', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(
      ndaAgreement('signed', true),
    );
    const service = createService();

    await expect(service.previewNdaByToken('tok')).rejects.toThrow(
      'NDA has already been signed',
    );
    await expect(service.previewNdaByToken('tok')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reports revoked instead of expired for a void past-window NDA', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(
      ndaAgreement('void', true),
    );

    await expect(createService().previewNdaByToken('tok')).rejects.toThrow(
      'no longer valid',
    );
  });

  it('reports expired for a pending past-window NDA', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(
      ndaAgreement('pending', true),
    );

    await expect(createService().previewNdaByToken('tok')).rejects.toThrow(
      'signing link has expired',
    );
  });
});
