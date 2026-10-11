import {
  vectorIndex as pgVectorIndex,
  deleteVectorsByOrganization,
  findVectorsByFilter,
  listVectorsByOrganization,
  listVectorsByOrganizationAndType,
  countVectorsByOrganization,
  upsertVectors,
} from '@gideon-defender/db';

export const vectorIndex = pgVectorIndex;
export {
  deleteVectorsByOrganization,
  findVectorsByFilter,
  listVectorsByOrganization,
  listVectorsByOrganizationAndType,
  countVectorsByOrganization,
  upsertVectors,
};
