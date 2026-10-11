const mockExecuteRaw = jest.fn();
jest.mock('@gideon-defender/db', () => ({
  deleteVectorsByOrganization: (...args: unknown[]) => mockExecuteRaw(...args),
}));
import { OrganizationVectorCleanupService } from './organization-vector-cleanup';

describe('OrganizationVectorCleanupService', () => {
  const service = new OrganizationVectorCleanupService();
  beforeEach(() => {
    mockExecuteRaw.mockReset();
  });

  it('deletes the entire tenant namespace without a document snapshot', async () => {
    mockExecuteRaw.mockResolvedValue(undefined);
    await expect(
      service.deleteOrganizationVectors({ organizationId: 'org_1' }),
    ).resolves.toEqual({ deleted: true, errors: [] });
    expect(mockExecuteRaw).toHaveBeenCalledWith('org_1');
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('reports deletion failure so the caller can report incomplete cleanup', async () => {
    mockExecuteRaw.mockRejectedValue(new Error('database down'));
    await expect(
      service.deleteOrganizationVectors({ organizationId: 'org_1' }),
    ).resolves.toEqual({
      deleted: false,
      errors: ['vector cleanup: database down'],
    });
  });
});
