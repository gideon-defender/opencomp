export interface VectorMetadata {
  organizationId: string;
  sourceType: string;
  sourceId: string;
  content: string | null;
  policyName: string | null;
  contextQuestion: string | null;
  documentName: string | null;
  manualAnswerQuestion: string | null;
  department: string | null;
  updatedAt: string | null;
  embeddingModel: string | null;
}

export interface VectorRecord {
  id: string;
  metadata: VectorMetadata;
}

// Upserts accept a partial metadata payload (optional fields may be omitted),
// matching how the API and app build metadata before writing.
export type VectorMetadataInput = Pick<
  VectorMetadata,
  'organizationId' | 'sourceType' | 'sourceId'
> &
  Partial<Omit<VectorMetadata, 'organizationId' | 'sourceType' | 'sourceId'>>;

export interface VectorRecordInput {
  id: string;
  vector: number[];
  metadata: VectorMetadataInput;
}

export interface VectorQueryOptions {
  vector: number[];
  topK: number;
  organizationId: string;
  includeMetadata?: boolean;
  filter?: string;
}

export interface VectorQueryResult {
  id: string;
  score: number;
  metadata?: VectorMetadata;
}

export interface VectorFetchOptions {
  includeVectors?: boolean;
}

export interface VectorFetchResult {
  id: string;
  vector?: number[];
  metadata?: VectorMetadata;
}

export interface VectorRangeOptions {
  cursor?: string;
  limit: number;
  prefix?: string;
  includeVectors?: boolean;
  includeMetadata?: boolean;
  organizationId: string;
}

export interface VectorRangeResult {
  vectors: VectorFetchResult[];
  nextCursor: string | null;
}

export interface VectorInfoResult {
  totalVectorCount: number;
  pendingVectorCount: number;
  dimension: number;
}

export interface VectorIndex {
  query(options: VectorQueryOptions): Promise<VectorQueryResult[]>;
  upsert(input: VectorRecordInput): Promise<{ id: string }>;
  fetch(
    ids: string[],
    organizationId: string,
    options?: VectorFetchOptions,
  ): Promise<VectorFetchResult[]>;
  delete(ids: string[], organizationId: string): Promise<void>;
  range(options: VectorRangeOptions): Promise<VectorRangeResult>;
  info(): Promise<VectorInfoResult>;
}
