import { Injectable, NotFoundException } from '@nestjs/common';
import { db } from '@db';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAccentColor } from './trust-access-helpers';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from './policy-pdf-renderer.service';
import { NdaPdfService } from './nda-pdf.service';
import { TrustGrantReadsService } from './trust-grant-reads.service';

/**
 * Combined all-policies PDF download for trust-portal grants.
 * Split from TrustAccessService; token validation comes from
 * TrustGrantReadsService.
 */
@Injectable()
export class TrustPolicyDownloadService {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly pdfRendererService: PolicyPdfRendererService,
    private readonly ndaPdfService: NdaPdfService,
    private readonly grantReads: TrustGrantReadsService,
  ) {}
  async downloadAllPoliciesByAccessToken(token: string) {
    const grant = await this.grantReads.validateAccessToken(token);

    const policies = await db.policy.findMany({
      where: {
        organizationId: grant.accessRequest.organizationId,
        status: 'published',
        isArchived: false,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        content: true,
        pdfUrl: true,
        currentVersion: {
          select: {
            content: true,
            pdfUrl: true,
          },
        },
      },
      orderBy: [{ lastPublishedAt: 'desc' }, { updatedAt: 'desc' }],
    });

    if (policies.length === 0) {
      throw new NotFoundException('No published policies available');
    }

    // Create merged PDF document
    const mergedPdf = await PDFDocument.create();

    const organizationName =
      grant.accessRequest.organization.name || 'Organization';

    // Get organization primary color or use default
    const accentColor = getAccentColor(
      grant.accessRequest.organization.primaryColor,
    );

    // Embed fonts once before the loop (expensive operation)
    const helveticaBold = await mergedPdf.embedFont(
      StandardFonts.HelveticaBold,
    );
    const helvetica = await mergedPdf.embedFont(StandardFonts.Helvetica);

    // Step 1: Fetch/render all PDFs in parallel (expensive I/O operations)
    type PreparedPolicy = {
      policy: (typeof policies)[0];
      pdfBuffer: Buffer;
      isUploaded: boolean;
    };

    // Helper to get effective content and pdfUrl (version first, fallback to policy)
    const getEffectiveData = (policy: (typeof policies)[0]) => {
      const content = policy.currentVersion?.content ?? policy.content;
      const pdfUrl = policy.currentVersion?.pdfUrl ?? policy.pdfUrl;
      return { content, pdfUrl };
    };

    const preparePolicy = async (
      policy: (typeof policies)[0],
    ): Promise<PreparedPolicy> => {
      const { content, pdfUrl } = getEffectiveData(policy);
      const hasUploadedPdf = pdfUrl && pdfUrl.trim() !== '';

      if (hasUploadedPdf) {
        try {
          const pdfBuffer =
            await this.attachmentsService.getObjectBuffer(pdfUrl);
          return {
            policy,
            pdfBuffer: Buffer.from(pdfBuffer),
            isUploaded: true,
          };
        } catch (error) {
          console.warn(
            `Failed to fetch uploaded PDF for policy ${policy.id}, falling back to content rendering:`,
            error,
          );
        }
      }

      // Render from content (either no pdfUrl or fetch failed)
      const renderedBuffer = this.pdfRendererService.renderPoliciesPdfBuffer(
        [{ name: policy.name, content }],
        undefined, // We'll add org header during merge
        grant.accessRequest.organization.primaryColor,
        policies.length,
      );
      return { policy, pdfBuffer: renderedBuffer, isUploaded: false };
    };

    const preparedPolicies = await Promise.all(policies.map(preparePolicy));

    // Step 2: Merge PDFs sequentially (must be sequential for PDFDocument operations)
    // Helper to add content-rendered policy to merged PDF
    const addContentRenderedPolicy = async (
      policy: (typeof policies)[0],
      addOrgHeader: boolean,
    ) => {
      const { content } = getEffectiveData(policy);
      const renderedBuffer = this.pdfRendererService.renderPoliciesPdfBuffer(
        [{ name: policy.name, content }],
        addOrgHeader ? organizationName : undefined,
        grant.accessRequest.organization.primaryColor,
        policies.length,
      );
      const renderedPdf = await PDFDocument.load(renderedBuffer);
      const copiedPages = await mergedPdf.copyPages(
        renderedPdf,
        renderedPdf.getPageIndices(),
      );
      for (const page of copiedPages) {
        mergedPdf.addPage(page);
      }
    };

    let isFirst = true;
    for (const { policy, pdfBuffer, isUploaded } of preparedPolicies) {
      if (isUploaded) {
        try {
          const uploadedPdf = await PDFDocument.load(pdfBuffer, {
            ignoreEncryption: true,
          });

          // Rebuild the FIRST page: embed original page into a taller page
          const originalFirstPage = uploadedPdf.getPage(0);
          const { width, height } = originalFirstPage.getSize();

          const headerHeight = isFirst ? 120 : 60;
          const embeddedFirstPage =
            await mergedPdf.embedPage(originalFirstPage);
          const rebuiltFirstPage = mergedPdf.addPage([
            width,
            height + headerHeight,
          ]);

          rebuiltFirstPage.drawPage(embeddedFirstPage, {
            x: 0,
            y: 0,
            width,
            height,
          });

          let yPos = height + headerHeight - 25;

          if (isFirst) {
            rebuiltFirstPage.drawLine({
              start: { x: 20, y: yPos + 8 },
              end: { x: width - 20, y: yPos + 8 },
              thickness: 2,
              color: rgb(accentColor.r, accentColor.g, accentColor.b),
            });

            rebuiltFirstPage.drawText(`${organizationName} - All Policies`, {
              x: 20,
              y: yPos - 14,
              size: 14,
              font: helveticaBold,
              color: rgb(0, 0, 0),
            });

            const generatedDate = new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });

            rebuiltFirstPage.drawText(
              `Generated: ${generatedDate} | Total: ${policies.length} policies`,
              {
                x: width - 180,
                y: yPos - 14,
                size: 8,
                font: helvetica,
                color: rgb(0.5, 0.5, 0.5),
              },
            );

            yPos -= 34;
            isFirst = false;
          }

          rebuiltFirstPage.drawRectangle({
            x: 55,
            y: yPos - 40,
            width: 10,
            height: 26,
            color: rgb(accentColor.r, accentColor.g, accentColor.b),
          });

          rebuiltFirstPage.drawText(`POLICY: ${policy.name}`, {
            x: 75,
            y: yPos - 34,
            size: 16,
            font: helveticaBold,
            color: rgb(0.12, 0.16, 0.23),
          });

          // Remaining pages unchanged (page 2..n)
          if (uploadedPdf.getPageCount() > 1) {
            const copiedRemainingPages = await mergedPdf.copyPages(
              uploadedPdf,
              uploadedPdf.getPageIndices().slice(1),
            );
            for (const page of copiedRemainingPages) {
              mergedPdf.addPage(page);
            }
          }
        } catch (error) {
          // PDF is corrupted/malformed, fall back to content rendering
          console.warn(
            `Failed to parse uploaded PDF for policy ${policy.id}, falling back to content rendering:`,
            error,
          );
          await addContentRenderedPolicy(policy, isFirst);
          isFirst = false;
        }
      } else {
        // Content was already rendered, but re-render if first (needs org header)
        await addContentRenderedPolicy(policy, isFirst);
        isFirst = false;
      }
    }

    // Add page numbers to all pages in the merged PDF
    const pages = mergedPdf.getPages();
    const totalPages = pages.length;
    // helvetica font already embedded above

    for (let i = 0; i < totalPages; i++) {
      const page = pages[i];
      const { width } = page.getSize();
      const pageNumber = i + 1;

      page.drawText(`Page ${pageNumber} of ${totalPages}`, {
        x: width / 2 - 30,
        y: 15,
        size: 8,
        font: helvetica,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    const pdfBuffer = Buffer.from(await mergedPdf.save());

    const bundleDocId = `bundle-${grant.id}-${Date.now()}`;
    const watermarked = await this.ndaPdfService.watermarkExistingPdf(
      pdfBuffer,
      {
        name: grant.accessRequest.name,
        email: grant.subjectEmail,
        docId: bundleDocId,
      },
    );

    const key = await this.attachmentsService.uploadToS3(
      watermarked,
      `policies-bundle-grant-${grant.id}-${Date.now()}.pdf`,
      'application/pdf',
      grant.accessRequest.organizationId,
      'trust_policy_downloads',
      `${grant.id}`,
    );

    const downloadUrl =
      await this.attachmentsService.getPresignedDownloadUrl(key);

    return { name: 'All Policies', downloadUrl };
  }
}
