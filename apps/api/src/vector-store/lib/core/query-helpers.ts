export type SourceType =
  'policy' | 'context' | 'manual_answer' | 'knowledge_base_document';

export interface ExistingEmbedding {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  updatedAt?: string;
}
