import { NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { db } from '@db';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustPublicService } from './trust-public.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustPolicyDownloadService } from './trust-policy-download.service';

jest.mock('@db', () => ({
  db: {
    trustAccessGrant: { findUnique: jest.fn() },
    policy: { findMany: jest.fn() },
  },
}));

const mockDb = db as unknown as {
  trustAccessGrant: { findUnique: jest.Mock };
  policy: { findMany: jest.Mock };
};

function activeGrant() {
  const future = new Date(Date.now() + 86_400_000);
  return {
    id: 'grant_1',
    status: 'active',
    expiresAt: future,
    accessToken: 'token',
    accessTokenExpiresAt: future,
    subjectEmail: 'ada@company.com',
    accessRequest: {
      organizationId: 'org_1',
      name: 'Ada Lovelace',
      organization: { name: 'Acme', primaryColor: null },
    },
  };
}

async function minimalPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  // Blank pages carry no Contents stream and cannot be embedded with
  // embedPage — draw text so the merge path exercises real embedding.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('test policy', { x: 50, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}

function createService(
  input: {
    attachments?: Partial<AttachmentsService>;
    pdfRenderer?: Partial<PolicyPdfRendererService>;
    ndaPdf?: Partial<NdaPdfService>;
  } = {},
) {
  const attachmentsService = {
    uploadToS3: jest.fn().mockResolvedValue('s3-key'),
    getPresignedDownloadUrl: jest
      .fn()
      .mockResolvedValue('https://signed-url/all-policies.pdf'),
    getObjectBuffer: jest.fn(),
    ...input.attachments,
  } as unknown as AttachmentsService;
  const pdfRendererService = {
    renderPoliciesPdfBuffer: jest.fn(),
    ...input.pdfRenderer,
  } as unknown as PolicyPdfRendererService;
  const ndaPdfService = {
    watermarkExistingPdf: jest
      .fn()
      .mockImplementation((buffer: Buffer) => Promise.resolve(buffer)),
    ...input.ndaPdf,
  } as unknown as NdaPdfService;
  const grantReads = new TrustGrantReadsService(
    ndaPdfService,
    {} as unknown as TrustPublicService,
  );
  const service = new TrustPolicyDownloadService(
    attachmentsService,
    pdfRendererService,
    ndaPdfService,
    grantReads,
  );
  return { service, attachmentsService, pdfRendererService, ndaPdfService };
}

function contentPolicy(id: string) {
  return {
    id,
    name: `Policy ${id}`,
    content: { text: 'policy content' },
    pdfUrl: null,
    currentVersion: null,
  };
}

describe('TrustPolicyDownloadService.downloadAllPoliciesByAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDb.trustAccessGrant.findUnique.mockResolvedValue(activeGrant());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws NotFound when no published policies exist', async () => {
    mockDb.policy.findMany.mockResolvedValue([]);
    const { service } = createService();

    await expect(
      service.downloadAllPoliciesByAccessToken('token'),
    ).rejects.toThrow('No published policies available');
    await expect(
      service.downloadAllPoliciesByAccessToken('token'),
    ).rejects.toThrow(NotFoundException);
  });

  it('renders content policies, watermarks, uploads, and returns a URL', async () => {
    mockDb.policy.findMany.mockResolvedValue([
      contentPolicy('pol_1'),
      contentPolicy('pol_2'),
    ]);
    const rendered = await minimalPdf();
    const { service, pdfRendererService, attachmentsService, ndaPdfService } =
      createService({
        pdfRenderer: {
          renderPoliciesPdfBuffer: jest.fn().mockReturnValue(rendered),
        },
      });

    const result = await service.downloadAllPoliciesByAccessToken('token');

    expect(pdfRendererService.renderPoliciesPdfBuffer).toHaveBeenCalled();
    expect(ndaPdfService.watermarkExistingPdf).toHaveBeenCalledTimes(1);
    expect(attachmentsService.uploadToS3).toHaveBeenCalledTimes(1);
    expect(attachmentsService.getPresignedDownloadUrl).toHaveBeenCalledWith(
      's3-key',
    );
    expect(result).toEqual({
      name: 'All Policies',
      downloadUrl: 'https://signed-url/all-policies.pdf',
    });
  });

  it('merges an uploaded PDF instead of rendering content', async () => {
    const uploaded = await minimalPdf();
    mockDb.policy.findMany.mockResolvedValue([
      {
        ...contentPolicy('pol_1'),
        pdfUrl: 'org_1/policies/uploaded.pdf',
      },
    ]);
    const { service, pdfRendererService, ndaPdfService } = createService({
      attachments: {
        getObjectBuffer: jest.fn().mockResolvedValue(uploaded),
      },
    });

    const result = await service.downloadAllPoliciesByAccessToken('token');

    expect(pdfRendererService.renderPoliciesPdfBuffer).not.toHaveBeenCalled();
    expect(ndaPdfService.watermarkExistingPdf).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('All Policies');
  });

  it('falls back to content rendering when the uploaded PDF fetch fails', async () => {
    mockDb.policy.findMany.mockResolvedValue([contentPolicy('pol_1')]);
    const rendered = await minimalPdf();
    const { service, pdfRendererService } = createService({
      attachments: {
        getObjectBuffer: jest
          .fn()
          .mockRejectedValue(new Error('S3 fetch failed')),
      },
      pdfRenderer: {
        renderPoliciesPdfBuffer: jest.fn().mockReturnValue(rendered),
      },
    });

    const result = await service.downloadAllPoliciesByAccessToken('token');

    expect(pdfRendererService.renderPoliciesPdfBuffer).toHaveBeenCalled();
    expect(result.name).toBe('All Policies');
  });
});
