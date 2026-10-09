import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntegrationMutations } from './use-integration-platform';

const mocks = vi.hoisted(() => ({ post: vi.fn(), orgId: 'org_1' as string | undefined }));
vi.mock('@/lib/api-client', () => ({ api: { post: mocks.post } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: mocks.orgId }) }));

describe('Integration OAuth requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgId = 'org_1';
    mocks.post.mockResolvedValue({
      data: { authorizationUrl: 'https://provider.example/authorize' },
    });
  });

  it('sends the selected connection ID through the actual mutation hook', async () => {
    const { result } = renderHook(() => useIntegrationMutations());
    await expect(
      result.current.startOAuth('azure', 'https://app.example/return', 'older_connection'),
    ).resolves.toEqual({ success: true, authorizationUrl: 'https://provider.example/authorize' });
    expect(mocks.post).toHaveBeenCalledWith('/v1/integrations/oauth/start', {
      providerSlug: 'azure',
      organizationId: 'org_1',
      redirectUrl: 'https://app.example/return',
      connectionId: 'older_connection',
    });
  });

  it('keeps new-connection authorization compatible without a target', async () => {
    const { result } = renderHook(() => useIntegrationMutations());
    await result.current.startOAuth('gcp');
    expect(mocks.post).toHaveBeenCalledWith('/v1/integrations/oauth/start', {
      providerSlug: 'gcp',
      organizationId: 'org_1',
      redirectUrl: undefined,
      connectionId: undefined,
    });
  });

  it('does not authorize without an active organization', async () => {
    mocks.orgId = undefined;
    const { result } = renderHook(() => useIntegrationMutations());
    await expect(
      result.current.startOAuth('azure', undefined, 'older_connection'),
    ).resolves.toEqual({ success: false, error: 'No organization selected' });
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
