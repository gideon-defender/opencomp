export * from '@prisma/client';
export { db, serviceDb, tenantDb, withService, withTenant } from './client.js';
export type { SslConfig } from './client.js';
export {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_IDENTITY,
  EMBEDDING_MODEL,
  embedTexts,
} from './embedding-client.js';
export { normalizeEmail } from './normalize-email.js';
export {
  countVectorsByOrganization,
  deleteVectorsByOrganization,
  findVectorsByFilter,
  listVectorsByOrganization,
  listVectorsByOrganizationAndType,
  upsertVectors,
  vectorIndex,
} from './vector-index.js';
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
} from './vector-index.js';
