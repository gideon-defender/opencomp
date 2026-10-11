import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type ObjectIdentifier,
} from '@aws-sdk/client-s3';
import {
  APP_AWS_KNOWLEDGE_BASE_BUCKET,
  APP_AWS_ORG_ASSETS_BUCKET,
  APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET,
  BUCKET_NAME,
  s3Client,
} from '../app/s3';
import type { CleanupBucketRef } from './organization-cleanup.types';

/**
 * Per-bucket S3 deletion for organization cleanup.
 *
 * Each bucket is attempted independently: a listing or delete failure in
 * one bucket is recorded and the rest still run. Snapshot keys are scoped
 * to their home bucket — one key set is never fanned out across buckets.
 *
 * List-then-delete has an inherent race: a PUT that lands between the
 * listing and the delete survives. Each bucket therefore runs bounded
 * verification passes — after deleting, it re-lists the org prefix and
 * deletes keys it has not already requested, up to MAX_DELETE_PASSES
 * total attempts. Only genuinely new keys are re-requested, so a stable
 * listing terminates after one verification pass. A PUT that lands
 * between the final list and its delete can still survive; nothing
 * short of versioning closes that window.
 */
@Injectable()
export class OrganizationS3CleanupService {
  private readonly logger = new Logger(OrganizationS3CleanupService.name);

  /** Total delete attempts per bucket: the initial pass plus re-list retries. */
  private static readonly MAX_DELETE_PASSES = 3;

  async deleteS3Objects({
    organizationId,
    keysByBucket,
  }: {
    organizationId: string;
    keysByBucket: Record<CleanupBucketRef, Set<string>>;
  }): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    if (!s3Client || typeof s3Client.send !== 'function') {
      const skipped = (Object.keys(keysByBucket) as CleanupBucketRef[]).reduce(
        (sum, ref) => sum + keysByBucket[ref].size,
        0,
      );
      if (skipped > 0) {
        // Collected keys exist but nothing can delete them: record it so
        // the caller reports orphans instead of a clean zero-delete.
        const message =
          `S3 client not configured — ` +
          `${skipped} collected key(s) skipped during cleanup of ${organizationId}`;
        errors.push(message);
        this.logger.error(message);
      } else {
        this.logger.warn('S3 client not configured — skipping S3 cleanup');
      }
      return { deleted: 0, errors };
    }
    const entries = [
      { ref: 'orgAssets', bucket: APP_AWS_ORG_ASSETS_BUCKET },
      { ref: 'default', bucket: BUCKET_NAME },
      { ref: 'knowledgeBase', bucket: APP_AWS_KNOWLEDGE_BASE_BUCKET },
      { ref: 'questionnaire', bucket: APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET },
    ] as Array<{ ref: CleanupBucketRef; bucket: string | undefined }>;
    const buckets = entries.filter(
      (entry): entry is { ref: CleanupBucketRef; bucket: string } =>
        Boolean(entry.bucket),
    );
    for (const { ref, bucket } of entries) {
      if (!bucket && keysByBucket[ref].size > 0) {
        const message =
          `bucket for ${ref} is not configured — ` +
          `${keysByBucket[ref].size} collected key(s) skipped during cleanup of ${organizationId}`;
        errors.push(message);
        this.logger.error(message);
      }
    }

    let deleted = 0;
    for (const { ref, bucket } of buckets) {
      // One bucket must not starve the rest: an unexpected throw inside
      // one bucket is recorded and the loop continues with the next.
      try {
        const result = await this.deleteBucketPrefix({
          organizationId,
          bucket,
          snapshotKeys: keysByBucket[ref],
        });
        deleted += result.deleted;
        errors.push(...result.errors);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = `S3 cleanup threw for bucket ${bucket} during cleanup of ${organizationId}: ${message}`;
        errors.push(failure);
        this.logger.error(failure);
      }
    }
    return { deleted, errors };
  }

  /**
   * Delete one bucket's share: snapshot keys plus everything currently
   * listed under the org prefix, with verification re-lists for stragglers.
   */
  private async deleteBucketPrefix({
    organizationId,
    bucket,
    snapshotKeys,
  }: {
    organizationId: string;
    bucket: string;
    snapshotKeys: Set<string>;
  }): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    const requested = new Set<string>();
    // Database references can contain caller-supplied keys. Only the tenant
    // namespace proves ownership; unscoped legacy keys require manual cleanup.
    const outstanding = new Set<string>();
    for (const key of snapshotKeys) {
      if (key.startsWith(`${organizationId}/`)) {
        outstanding.add(key);
      } else {
        errors.push(
          `Skipped S3 key outside organization namespace in ${bucket}`,
        );
      }
    }
    // The initial listing doubles as the straggler source: keys written
    // between collect and row delete are picked up here. When even the
    // first listing fails, snapshot keys are still attempted below, but
    // verification is skipped — a re-list would fail the same way and
    // add noise, not signal.
    const listedOk = await this.listIntoPrefix({
      organizationId,
      bucket,
      requested,
      outstanding,
      errors,
    });
    if (outstanding.size === 0) return { deleted: 0, errors };

    let deleted = 0;
    let passes = 0;
    while (
      outstanding.size > 0 &&
      passes < OrganizationS3CleanupService.MAX_DELETE_PASSES
    ) {
      const batch = [...outstanding];
      batch.forEach((key) => requested.add(key));
      outstanding.clear();
      const result = await this.deleteBatched({
        bucket,
        keys: batch,
        organizationId,
      });
      deleted += result.deleted;
      errors.push(...result.errors);
      passes += 1;
      // Retry delete failures and pick up keys that landed after the
      // previous listing. Already-requested keys are never re-requested,
      // so a stable listing ends the loop after one verification pass.
      result.failedKeys.forEach((key) => outstanding.add(key));
      if (listedOk && passes < OrganizationS3CleanupService.MAX_DELETE_PASSES) {
        const relisted = await this.listIntoPrefix({
          organizationId,
          bucket,
          requested,
          outstanding,
          errors,
        });
        if (!relisted) break;
      }
    }
    return { deleted, errors };
  }

  /**
   * Add every key currently listed under the org prefix to `outstanding`,
   * skipping keys already requested for deletion. Returns false when the
   * listing itself failed (the error is recorded); callers keep their
   * snapshot keys and skip verification in that case.
   */
  private async listIntoPrefix({
    organizationId,
    bucket,
    requested,
    outstanding,
    errors,
  }: {
    organizationId: string;
    bucket: string;
    requested: Set<string>;
    outstanding: Set<string>;
    errors: string[];
  }): Promise<boolean> {
    if (!s3Client || typeof s3Client.send !== 'function') return false;
    try {
      let continuationToken: string | undefined;
      do {
        const listed = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `${organizationId}/`,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of listed.Contents ?? []) {
          if (obj.Key && !requested.has(obj.Key)) outstanding.add(obj.Key);
        }
        continuationToken = listed.IsTruncated
          ? listed.NextContinuationToken
          : undefined;
      } while (continuationToken);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`list ${bucket}: ${message}`);
      this.logger.error(
        `S3 list failed in bucket ${bucket} during cleanup of ${organizationId}: ${message}`,
      );
      // Fall through: snapshot keys already in `outstanding` are still
      // attempted; only verification is skipped.
      return false;
    }
  }

  private async deleteBatched({
    bucket,
    keys,
    organizationId,
  }: {
    bucket: string;
    keys: string[];
    organizationId: string;
  }): Promise<{ deleted: number; errors: string[]; failedKeys: string[] }> {
    const errors: string[] = [];
    const failedKeys: string[] = [];
    if (!s3Client || typeof s3Client.send !== 'function') {
      return { deleted: 0, errors, failedKeys };
    }
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys
        .slice(i, i + 1000)
        .map<ObjectIdentifier>((Key) => ({ Key }));
      try {
        const res = await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch, Quiet: true },
          }),
        );
        const failures = (res.Errors ?? []) as Array<{
          Key?: string;
          Code?: string;
          Message?: string;
        }>;
        deleted += batch.length - failures.length;
        for (const failure of failures) {
          if (failure.Key) failedKeys.push(failure.Key);
          const cause =
            failure.Code !== undefined
              ? ` (${failure.Code}${failure.Message !== undefined ? `: ${failure.Message}` : ''})`
              : '';
          const message =
            `S3 delete failed for key "${failure.Key ?? 'unknown'}" ` +
            `in bucket ${bucket} during cleanup of ${organizationId}${cause}`;
          errors.push(message);
          this.logger.error(message);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`delete batch of ${batch.length} in ${bucket}: ${message}`);
        this.logger.error(
          `S3 delete batch failed in bucket ${bucket} during cleanup of ${organizationId}: ${message}`,
        );
        // The whole batch is unconfirmed — retry it on the next pass.
        failedKeys.push(...keys.slice(i, i + 1000));
      }
    }
    return { deleted, errors, failedKeys };
  }
}
