import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
import { NdaPdfService } from './nda-pdf.service';
import {
  TrustNdaPreviewService,
  isPreviewCacheMiss,
} from './trust-nda-preview.service';

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

const NO_SUCH_KEY = Object.assign(new Error('NoSuchKey'), {
  name: 'NoSuchKey',
});

function createPreviewService(deps: {
  pdfBuffer?: Buffer;
  storedBuffer?: Buffer | null;
  readError?: unknown;
}) {
  const ndaPdfService = {
    generateNdaPdf: jest
      .fn()
      .mockResolvedValue(deps.pdfBuffer ?? Buffer.from('pdf')),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed-url'),
  } as unknown as NdaPdfService;
  const attachmentsService = {
    getObjectBuffer: deps.storedBuffer
      ? jest.fn().mockResolvedValue(deps.storedBuffer)
      : jest.fn().mockRejectedValue(deps.readError ?? NO_SUCH_KEY),
    uploadBuffer: jest.fn().mockResolvedValue(undefined),
  } as unknown as AttachmentsService;
  const service = new TrustNdaPreviewService(ndaPdfService, attachmentsService);
  return {
    service,
    generateNdaPdf: ndaPdfService.generateNdaPdf as unknown as jest.Mock,
    getObjectBuffer: attachmentsService.getObjectBuffer as unknown as jest.Mock,
    uploadBuffer: attachmentsService.uploadBuffer as unknown as jest.Mock,
    getSignedUrl: ndaPdfService.getSignedUrl as unknown as jest.Mock,
  };
}

describe('TrustNdaPreviewService.getPreviewNdaPdfBuffer', () => {
  const request = {
    id: 'req_1',
    name: 'Jane',
    email: 'jane@example.com',
    organization: { name: 'Acme' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFound for an unknown request', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(null);
    const { service } = createPreviewService({});

    await expect(
      service.getPreviewNdaPdfBuffer('org_1', 'missing'),
    ).rejects.toThrow(NotFoundException);
  });

  it('streams the stored preview without regenerating', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const stored = Buffer.from('stored-pdf');
    const { service, generateNdaPdf, uploadBuffer } = createPreviewService({
      storedBuffer: stored,
    });

    const result = await service.getPreviewNdaPdfBuffer('org_1', 'req_1');

    expect(result.buffer).toBe(stored);
    expect(result.filename).toBe('nda_preview_req1.pdf');
    expect(generateNdaPdf).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('generates, persists, and returns the preview when none is stored', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const fresh = Buffer.from('fresh-pdf');
    const { service, generateNdaPdf, uploadBuffer, getObjectBuffer } =
      createPreviewService({ pdfBuffer: fresh });

    const result = await service.getPreviewNdaPdfBuffer('org_1', 'req_1');

    expect(result.buffer).toBe(fresh);
    expect(generateNdaPdf).toHaveBeenCalledWith({
      organizationName: 'Acme',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: expect.stringMatching(/^preview-/),
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-req_1.pdf',
      fresh,
      'application/pdf',
    );
    expect(getObjectBuffer).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-req_1.pdf',
    );
  });

  it('sanitizes the route param in the streamed filename', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const { service } = createPreviewService({
      storedBuffer: Buffer.from('stored-pdf'),
    });

    const result = await service.getPreviewNdaPdfBuffer('org_1', '../evil');

    expect(result.filename).toBe('nda_preview_evil.pdf');
  });

  it('rethrows S3 permission failures instead of regenerating', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const forbidden = Object.assign(new Error('Forbidden'), {
      name: 'Forbidden',
    });
    const { service, generateNdaPdf, uploadBuffer } = createPreviewService({
      readError: forbidden,
    });

    await expect(
      service.getPreviewNdaPdfBuffer('org_1', 'req_1'),
    ).rejects.toThrow('Forbidden');
    expect(generateNdaPdf).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('rethrows empty-body S3 errors instead of regenerating', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const { service, generateNdaPdf, uploadBuffer } = createPreviewService({
      readError: new InternalServerErrorException(
        'No file data received from S3',
      ),
    });

    await expect(
      service.getPreviewNdaPdfBuffer('org_1', 'req_1'),
    ).rejects.toThrow(InternalServerErrorException);
    expect(generateNdaPdf).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('regenerates when S3 reports a 404 status code', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const notFoundStatus = Object.assign(new Error('Not Found'), {
      name: 'Error',
      $metadata: { httpStatusCode: 404 },
    });
    const fresh = Buffer.from('fresh-pdf');
    const { service, generateNdaPdf } = createPreviewService({
      pdfBuffer: fresh,
      readError: notFoundStatus,
    });

    const result = await service.getPreviewNdaPdfBuffer('org_1', 'req_1');

    expect(result.buffer).toBe(fresh);
    expect(generateNdaPdf).toHaveBeenCalled();
  });
});

describe('TrustNdaPreviewService.previewNda', () => {
  const request = {
    id: 'req_1',
    name: 'Jane',
    email: 'jane@example.com',
    organization: { name: 'Acme' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFound for an unknown request', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(null);
    const { service } = createPreviewService({});

    await expect(service.previewNda('org_1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('generates, persists, and returns a signed URL', async () => {
    mockDb.trustAccessRequest.findFirst.mockResolvedValue(request);
    const fresh = Buffer.from('fresh-pdf');
    const { service, generateNdaPdf, uploadBuffer, getSignedUrl } =
      createPreviewService({ pdfBuffer: fresh });

    const result = await service.previewNda('org_1', 'req_1');

    expect(result.previewId).toEqual(expect.any(String));
    expect(result.s3Key).toBe('org_1/trust_nda/preview-req_1.pdf');
    expect(result.pdfDownloadUrl).toBe('https://signed-url');
    expect(generateNdaPdf).toHaveBeenCalledWith({
      organizationName: 'Acme',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: expect.stringMatching(/^preview-/),
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-req_1.pdf',
      fresh,
      'application/pdf',
    );
    expect(getSignedUrl).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-req_1.pdf',
    );
  });
});

describe('TrustNdaPreviewService.previewNdaByToken', () => {
  const agreement = {
    id: 'nda_1',
    organizationId: 'org_1',
    status: 'pending',
    signTokenExpiresAt: new Date(Date.now() + 86_400_000),
    accessRequest: {
      name: 'Jane',
      email: 'jane@example.com',
      organization: { name: 'Acme' },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws NotFound for an unknown token', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(null);
    const { service } = createPreviewService({});

    await expect(service.previewNdaByToken('bad')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('generates, persists, and returns a signed URL for a pending token', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue(agreement);
    const fresh = Buffer.from('fresh-pdf');
    const { service, generateNdaPdf, uploadBuffer, getSignedUrl } =
      createPreviewService({ pdfBuffer: fresh });

    const result = await service.previewNdaByToken('tok_123');

    expect(result.previewId).toEqual(expect.any(String));
    expect(result.s3Key).toBe('org_1/trust_nda/preview-nda-nda_1.pdf');
    expect(result.pdfDownloadUrl).toBe('https://signed-url');
    expect(generateNdaPdf).toHaveBeenCalledWith({
      organizationName: 'Acme',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: expect.stringMatching(/^preview-/),
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-nda-nda_1.pdf',
      fresh,
      'application/pdf',
    );
    expect(getSignedUrl).toHaveBeenCalledWith(
      'org_1/trust_nda/preview-nda-nda_1.pdf',
    );
  });

  it('does not generate when the signing link has expired', async () => {
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      ...agreement,
      signTokenExpiresAt: new Date(Date.now() - 86_400_000),
    });
    const { service, generateNdaPdf, uploadBuffer } = createPreviewService({});

    await expect(service.previewNdaByToken('tok_123')).rejects.toThrow(
      'signing link has expired',
    );
    expect(generateNdaPdf).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('does not generate for void or signed agreements', async () => {
    const { service: voidService, generateNdaPdf: voidGenerate } =
      createPreviewService({});
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      ...agreement,
      status: 'void',
    });
    await expect(voidService.previewNdaByToken('tok_123')).rejects.toThrow(
      'no longer valid',
    );
    expect(voidGenerate).not.toHaveBeenCalled();

    const { service: signedService, generateNdaPdf: signedGenerate } =
      createPreviewService({});
    mockDb.trustNDAAgreement.findUnique.mockResolvedValue({
      ...agreement,
      status: 'signed',
    });
    await expect(signedService.previewNdaByToken('tok_123')).rejects.toThrow(
      'already been signed',
    );
    expect(signedGenerate).not.toHaveBeenCalled();
  });
});

describe('isPreviewCacheMiss', () => {
  it('matches NoSuchKey and NotFound names', () => {
    expect(
      isPreviewCacheMiss(Object.assign(new Error('x'), { name: 'NoSuchKey' })),
    ).toBe(true);
    expect(
      isPreviewCacheMiss(Object.assign(new Error('x'), { name: 'NotFound' })),
    ).toBe(true);
  });

  it('matches 404 status metadata regardless of name', () => {
    expect(
      isPreviewCacheMiss(
        Object.assign(new Error('x'), {
          name: 'Error',
          $metadata: { httpStatusCode: 404 },
        }),
      ),
    ).toBe(true);
  });

  it('rejects permission, network, and empty values', () => {
    expect(
      isPreviewCacheMiss(Object.assign(new Error('x'), { name: 'Forbidden' })),
    ).toBe(false);
    expect(
      isPreviewCacheMiss(
        new InternalServerErrorException('No file data received from S3'),
      ),
    ).toBe(false);
    expect(isPreviewCacheMiss(null)).toBe(false);
    expect(isPreviewCacheMiss(undefined)).toBe(false);
  });
});
