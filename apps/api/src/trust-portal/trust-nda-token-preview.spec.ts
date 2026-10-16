import { Test } from '@nestjs/testing';
import { AttachmentsService } from '../attachments/attachments.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustNdaPreviewService } from './trust-nda-preview.service';

jest.mock('@db', () => ({
  db: { trustNDAAgreement: { findUnique: jest.fn() } },
}));

describe('token NDA PDF preview', () => {
  const pdf = Buffer.from('%PDF-preview');
  const generateNdaPdf = jest.fn().mockResolvedValue(pdf);
  const uploadBuffer = jest.fn();
  const getSignedUrl = jest.fn();
  const { db } = jest.requireMock<{
    db: { trustNDAAgreement: { findUnique: jest.Mock } };
  }>('@db');
  const findUnique = db.trustNDAAgreement.findUnique;
  const agreement = {
    id: 'nda_1',
    organizationId: 'org_1',
    status: 'pending',
    signTokenExpiresAt: new Date(Date.now() + 86_400_000),
    accessRequest: {
      name: 'Ada',
      email: 'ada@example.com',
      organization: { name: 'Acme' },
    },
  };
  let service: TrustNdaPreviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TrustNdaPreviewService,
        { provide: NdaPdfService, useValue: { generateNdaPdf, getSignedUrl } },
        { provide: AttachmentsService, useValue: { uploadBuffer } },
      ],
    }).compile();
    service = module.get(TrustNdaPreviewService);
  });

  it('returns PDF bytes without a browser connection to S3', async () => {
    findUnique.mockResolvedValueOnce(agreement);
    const result = await service.getPreviewNdaPdfByToken('token');

    expect(result.buffer).toBe(pdf);
    expect(result.filename).toBe('nda_preview_nda1.pdf');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { signToken: 'token' } }),
    );
    expect(generateNdaPdf).toHaveBeenCalledWith({
      organizationName: 'Acme',
      signerName: 'Ada',
      signerEmail: 'ada@example.com',
      agreementId: expect.stringMatching(/^preview-/),
    });
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null, 'NDA not found'],
    ['signed', { ...agreement, status: 'signed' }, 'already been signed'],
    ['revoked', { ...agreement, status: 'void' }, 'no longer valid'],
    ['expired', { ...agreement, signTokenExpiresAt: new Date(0) }, 'expired'],
  ])('rejects %s tokens before PDF generation', async (_, nda, message) => {
    findUnique.mockResolvedValueOnce(nda);
    await expect(service.getPreviewNdaPdfByToken('token')).rejects.toThrow(
      message,
    );
    expect(generateNdaPdf).not.toHaveBeenCalled();
  });
});
