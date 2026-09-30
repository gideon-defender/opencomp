import { PDFDocument } from 'pdf-lib';
import { NdaPdfService } from './nda-pdf.service';
import { AttachmentsService } from '../attachments/attachments.service';

function createService() {
  return new NdaPdfService({} as unknown as AttachmentsService);
}

describe('NdaPdfService organization watermark', () => {
  it('renders a valid PDF for a short organization name', async () => {
    const buffer = await createService().generateNdaPdf({
      organizationName: 'Acme',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: 'agr_123',
    });

    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a valid PDF for a long organization name without throwing', async () => {
    const buffer = await createService().generateNdaPdf({
      organizationName: 'Gideon Defender, Inc',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: 'agr_123',
    });

    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('watermarks an existing PDF with the organization name', async () => {
    const service = createService();
    const original = await service.generateNdaPdf({
      organizationName: 'Gideon Defender, Inc',
      signerName: 'Jane',
      signerEmail: 'jane@example.com',
      agreementId: 'agr_123',
    });

    const watermarked = await service.watermarkExistingPdf(original, {
      organizationName: 'Gideon Defender, Inc',
      name: 'Jane',
      email: 'jane@example.com',
      docId: 'doc_1',
    });

    const doc = await PDFDocument.load(watermarked);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(watermarked.length).toBeGreaterThan(0);
  });
});
