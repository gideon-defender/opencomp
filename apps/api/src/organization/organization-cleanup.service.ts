import { Injectable, Logger } from '@nestjs/common';
import { db } from '@db';
import { extractS3KeyFromUrl } from '../app/s3';
import { OrganizationS3CleanupService } from './organization-s3-cleanup';
import { OrganizationVectorCleanupService } from './organization-vector-cleanup';
import type {
  CleanupBucketRef,
  CollectedAssets,
  OrganizationExternalCleanup,
} from './organization-cleanup.types';

export type { OrganizationExternalCleanup } from './organization-cleanup.types';

/**
 * Best-effort external-asset cleanup for organization deletion.
 *
 * The org-scoped `DELETE /v1/organization` previously removed only DB rows,
 * orphaning evidence files in S3 and embeddings in the vector store on every
 * delete (the admin-only purge that cleaned them was removed with platform
 * admin).
 *
 * Ordering matters and lives in `OrganizationService.deleteById`: collect
 * references first, delete the DB row, then destroy externals. Destroying
 * S3 objects before the row commits would leave live rows pointing at
 * deleted objects if the DB delete failed, so this service exposes the two
 * phases separately (`collectAssetReferences` + `deleteCollectedAssets`).
 *
 * Every stage degrades per item, never fail-fast: one unreadable table,
 * one failed bucket, or one failed vector deletion must not orphan the
 * rest. Partial failures come back as error lists in the result.
 */
@Injectable()
export class OrganizationCleanupService {
  private readonly logger = new Logger(OrganizationCleanupService.name);

  constructor(
    private readonly s3: OrganizationS3CleanupService,
    private readonly vectors: OrganizationVectorCleanupService,
  ) {}

  async cleanupOrganizationAssets({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationExternalCleanup> {
    const collected = await this.collectAssetReferences({ organizationId });
    return this.deleteCollectedAssets({ organizationId, collected });
  }

  async deleteCollectedAssets({
    organizationId,
    collected,
  }: {
    organizationId: string;
    collected: CollectedAssets;
  }): Promise<OrganizationExternalCleanup> {
    // The two stages run in isolation: an unexpected throw in S3 deletion
    // must not skip vector deletion, and vice versa. Each stage records
    // its own failure so the caller sees partial progress, not a throw.
    let s3 = { deleted: 0, errors: [] as string[] };
    try {
      s3 = await this.s3.deleteS3Objects({
        organizationId,
        keysByBucket: collected.keysByBucket,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      s3.errors.push(`S3 cleanup threw: ${message}`);
      this.logger.error(
        `S3 cleanup threw during cleanup of ${organizationId}: ${message}`,
      );
    }
    let vectors = { deleted: false, errors: [] as string[] };
    try {
      vectors = await this.vectors.deleteOrganizationVectors({
        organizationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vectors.errors.push(`vector cleanup threw: ${message}`);
      this.logger.error(
        `Vector cleanup threw during cleanup of ${organizationId}: ${message}`,
      );
    }
    return {
      s3ObjectsDeleted: s3.deleted,
      vectorsDeleted: vectors.deleted,
      knowledgeBaseDocumentsQueued: 0,
      manualAnswersQueued: false,
      collectErrors: collected.collectErrors,
      s3Errors: s3.errors,
      vectorErrors: vectors.errors,
    };
  }

  /** Empty asset set for when collection itself throws unexpectedly. */
  emptyCollectedAssets(): CollectedAssets {
    return {
      keysByBucket: {
        orgAssets: new Set(),
        default: new Set(),
        knowledgeBase: new Set(),
        questionnaire: new Set(),
      },
      knowledgeBaseDocumentIds: [],
      manualAnswerIds: [],
      collectErrors: [],
    };
  }

  async collectAssetReferences({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<CollectedAssets> {
    const collectErrors: string[] = [];
    const settled = await Promise.allSettled([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { logo: true },
      }),
      db.trustResource.findMany({
        where: { organizationId },
        select: { s3Key: true },
      }),
      db.trustNDAAgreement.findMany({
        where: { organizationId },
        select: { pdfTemplateKey: true, pdfSignedKey: true },
      }),
      db.trustDocument.findMany({
        where: { organizationId },
        select: { s3Key: true },
      }),
      db.organizationChart.findUnique({
        where: { organizationId },
        select: { uploadedImageUrl: true },
      }),
      db.questionnaire.findMany({
        where: { organizationId },
        select: { s3Key: true },
      }),
      db.knowledgeBaseDocument.findMany({
        where: { organizationId },
        select: { id: true, s3Key: true },
      }),
      db.evidenceAutomationVersion.findMany({
        where: { evidenceAutomation: { task: { organizationId } } },
        select: { scriptKey: true },
      }),
      db.attachment.findMany({
        where: { organizationId },
        select: { url: true },
      }),
      db.securityQuestionnaireManualAnswer.findMany({
        where: { organizationId },
        select: { id: true },
      }),
    ]);
    const names = [
      'organization',
      'trustResource',
      'trustNDAAgreement',
      'trustDocument',
      'organizationChart',
      'questionnaire',
      'knowledgeBaseDocument',
      'evidenceAutomationVersion',
      'attachment',
      'manualAnswer',
    ] as const;
    const value = <T>(index: number, fallback: T): T => {
      const result = settled[index];
      if (result.status === 'fulfilled') return result.value as T;
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      collectErrors.push(`${names[index]}: ${reason}`);
      this.logger.warn(
        `Cleanup collect skipped ${names[index]} for ${organizationId}: ${reason}`,
      );
      return fallback;
    };
    const org = value(0, null as { logo: string | null } | null);
    const trustResources = value(1, [] as Array<{ s3Key: string | null }>);
    const trustNdas = value(
      2,
      [] as Array<{
        pdfTemplateKey: string | null;
        pdfSignedKey: string | null;
      }>,
    );
    const trustDocs = value(3, [] as Array<{ s3Key: string | null }>);
    const orgChart = value(
      4,
      null as { uploadedImageUrl: string | null } | null,
    );
    const questionnaires = value(5, [] as Array<{ s3Key: string | null }>);
    const kbDocs = value(6, [] as Array<{ id: string; s3Key: string | null }>);
    const scriptVersions = value(7, [] as Array<{ scriptKey: string | null }>);
    const attachments = value(8, [] as Array<{ url: string | null }>);
    const manualAnswers = value(9, [] as Array<{ id: string }>);

    const keysByBucket: Record<CleanupBucketRef, Set<string>> = {
      orgAssets: new Set(),
      default: new Set(),
      knowledgeBase: new Set(),
      questionnaire: new Set(),
    };
    const add = (ref: CleanupBucketRef, key: string | null | undefined) => {
      if (key) keysByBucket[ref].add(key);
    };
    add('orgAssets', org?.logo ?? null);
    for (const row of trustResources) add('orgAssets', row.s3Key);
    for (const row of trustDocs) add('orgAssets', row.s3Key);
    for (const row of trustNdas) {
      add('default', row.pdfTemplateKey);
      add('default', row.pdfSignedKey);
    }
    add('default', orgChart?.uploadedImageUrl ?? null);
    for (const row of scriptVersions) add('default', row.scriptKey);
    for (const row of questionnaires) add('questionnaire', row.s3Key);
    for (const row of kbDocs) add('knowledgeBase', row.s3Key);
    for (const row of attachments) {
      if (!row.url) continue;
      try {
        add('default', extractS3KeyFromUrl(row.url));
      } catch {
        collectErrors.push('attachment: unparseable URL skipped');
        this.logger.warn(
          `Skipping attachment with unparseable URL during cleanup of ${organizationId}`,
        );
      }
    }
    return {
      keysByBucket,
      knowledgeBaseDocumentIds: kbDocs.map((doc) => doc.id),
      manualAnswerIds: manualAnswers.map((answer) => answer.id),
      collectErrors,
    };
  }
}
