/** Shared shapes for organization external-asset cleanup. */
export interface OrganizationExternalCleanup {
  s3ObjectsDeleted: number;
  vectorsDeleted: boolean;
  /** Legacy queue counters remain zero; vectors are deleted directly. */
  knowledgeBaseDocumentsQueued: number;
  manualAnswersQueued: boolean;
  collectErrors: string[];
  s3Errors: string[];
  vectorErrors: string[];
}

/** Snapshot keys are partitioned by home bucket (same mapping as the retired
 * admin purge snapshot): a key is deleted only from its own bucket, plus
 * whatever the per-bucket prefix listing finds. */
export type CleanupBucketRef =
  'orgAssets' | 'default' | 'knowledgeBase' | 'questionnaire';

export interface CollectedAssets {
  keysByBucket: Record<CleanupBucketRef, Set<string>>;
  knowledgeBaseDocumentIds: string[];
  manualAnswerIds: string[];
  collectErrors: string[];
}
