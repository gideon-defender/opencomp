import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { APP_AWS_ORG_ASSETS_BUCKET, s3Client, getSignedUrl } from '../app/s3';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import { TrustGrantReadsService } from './trust-grant-reads.service';

/**
 * Additional-documents bundle download for trust-portal grants.
 * Split from TrustAccessService; token validation comes from
 * TrustGrantReadsService.
 */
@Injectable()
export class TrustDocumentDownloadService {
  constructor(private readonly grantReads: TrustGrantReadsService) {}
  async downloadAllTrustDocumentsByAccessToken(token: string) {
    const grant = await this.grantReads.validateAccessToken(token);

    if (!s3Client || !APP_AWS_ORG_ASSETS_BUCKET) {
      throw new InternalServerErrorException(
        'Organization assets bucket is not configured',
      );
    }

    const organizationId = grant.accessRequest.organizationId;
    const documents = await db.trustDocument.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        s3Key: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (documents.length === 0) {
      throw new NotFoundException('No additional documents available');
    }

    const timestamp = Date.now();
    // Fixed key per grant: repeated downloads overwrite instead of
    // accumulating one bundle object per call.
    const zipKey = `${organizationId}/trust-documents/bundles/${grant.id}/documents.zip`;

    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = new PassThrough();
    let putPromise: Promise<unknown> | undefined;

    try {
      putPromise = s3Client.send(
        new PutObjectCommand({
          Bucket: APP_AWS_ORG_ASSETS_BUCKET,
          Key: zipKey,
          Body: zipStream,
          ContentType: 'application/zip',
          Metadata: {
            organizationId,
            grantId: grant.id,
            kind: 'trust_documents_bundle',
          },
        }),
      );

      archive.on('error', (err) => {
        zipStream.destroy(err);
      });

      archive.pipe(zipStream);

      // Track names case-insensitively to avoid collisions on case-insensitive filesystems
      // (e.g. Windows/macOS): "Report.pdf" vs "report.pdf"
      const usedNamesLower = new Set<string>();
      const toSafeName = (name: string): string => {
        const sanitized =
          name.replace(/[^\w.\-() ]/g, '_').trim() || 'document';
        const dot = sanitized.lastIndexOf('.');
        const base = dot > 0 ? sanitized.slice(0, dot) : sanitized;
        const ext = dot > 0 ? sanitized.slice(dot) : '';

        let candidate = `${base}${ext}`;
        let i = 1;
        while (usedNamesLower.has(candidate.toLowerCase())) {
          candidate = `${base} (${i})${ext}`;
          i += 1;
        }
        usedNamesLower.add(candidate.toLowerCase());
        return candidate;
      };

      for (const doc of documents) {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: APP_AWS_ORG_ASSETS_BUCKET,
            Key: doc.s3Key,
          }),
        );

        if (!response.Body) {
          throw new InternalServerErrorException(
            `No file data received from S3 for document ${doc.id}`,
          );
        }

        const body: unknown = response.Body;
        const bodyStream =
          body instanceof Readable
            ? body
            : Readable.from(body as Iterable<Uint8Array>);

        archive.append(bodyStream, { name: toSafeName(doc.name) });
      }

      await archive.finalize();
      await putPromise;
    } catch (error) {
      // Ensure the upload stream is closed, otherwise the S3 PutObject may hang/reject later.
      try {
        archive.abort();
      } catch {
        // ignore — abort throws when the archive already finalized or was
        // never started; the destroy below carries the original error.
      }

      if (!zipStream.destroyed) {
        zipStream.destroy(
          error instanceof Error ? error : new Error('ZIP generation failed'),
        );
      }

      // Avoid unhandled rejections from an in-flight S3 put.
      await putPromise?.catch(() => undefined);

      // Delete the partially written object so failed bundles do not
      // accumulate orphan ZIPs in the bucket.
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: APP_AWS_ORG_ASSETS_BUCKET,
            Key: zipKey,
          }),
        );
      } catch {
        // ignore — the key may not exist if the put never started
      }

      throw error;
    }

    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: APP_AWS_ORG_ASSETS_BUCKET,
        Key: zipKey,
        ResponseContentDisposition: `attachment; filename="additional-documents-${timestamp}.zip"`,
      }),
      { expiresIn: 900 },
    );

    return {
      name: 'Additional Documents',
      fileCount: documents.length,
      downloadUrl: signedUrl,
    };
  }
}
