export * from '@prisma/client';
export { db, serviceDb, tenantDb, withService, withTenant } from './client';
export type { SslConfig } from './client';
export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_IDENTITY,
  EMBEDDING_MODEL,
  embedTexts,
} from './embedding-client';
export {
  countVectorsByOrganization,
  deleteVectorsByOrganization,
  findVectorsByFilter,
  listVectorsByOrganization,
  listVectorsByOrganizationAndType,
  upsertVectors,
  vectorIndex,
} from './vector-index';
export type {
  VectorFetchOptions,
  VectorFetchResult,
  VectorIndex,
  VectorInfoResult,
  VectorMetadata,
  VectorMetadataInput,
  VectorQueryOptions,
  VectorQueryResult,
  VectorRangeOptions,
  VectorRangeResult,
  VectorRecord,
  VectorRecordInput,
} from './vector-index';
