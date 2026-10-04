import type { ConnectionListItemResponse } from '@gideon-defender/integration-platform';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { newestPendingFromList, usePendingAwsConnection } from './use-pending-aws-connection';

function listRow(
  overrides: Partial<ConnectionListItemResponse> & { id: string },
): ConnectionListItemResponse {
  return {
    providerSlug: 'aws',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: { externalId: 'org_org_1_issued' },
    ...overrides,
  } as unknown as ConnectionListItemResponse;
}

describe('newestPendingFromList', () => {
  it('returns null when no pending row carries an externalId', () => {
    expect(newestPendingFromList([], 'aws')).toBeNull();
    expect(
      newestPendingFromList(
        [listRow({ id: 'a', status: 'active' }), listRow({ id: 'b', metadata: {} })],
        'aws',
      ),
    ).toBeNull();
  });

  it('ignores other providers and rows without an externalId', () => {
    const rows = [
      listRow({ id: 'other', providerSlug: 'gcp' }),
      listRow({ id: 'no-id', metadata: {} }),
      listRow({ id: 'match' }),
    ];
    expect(newestPendingFromList(rows, 'aws')).toEqual({
      id: 'match',
      externalId: 'org_org_1_issued',
    });
  });

  it('picks the newest pending row when several exist', () => {
    const rows = [
      listRow({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      listRow({
        id: 'new',
        createdAt: '2026-02-01T00:00:00.000Z',
        metadata: { externalId: 'org_org_1_newer' },
      }),
    ];
    expect(newestPendingFromList(rows, 'aws')).toEqual({
      id: 'new',
      externalId: 'org_org_1_newer',
    });
  });
});

describe('usePendingAwsConnection', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('starts empty when nothing is stored and the list is empty', () => {
    const { result } = renderHook(() =>
      usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections: [] }),
    );
    expect(result.current.pendingConnection).toBeNull();
  });

  it('restores the session value instead of reading the list', () => {
    window.sessionStorage.setItem(
      'pending-aws-connection:org_1:aws',
      JSON.stringify({ id: 'conn_stored', externalId: 'org_org_1_stored' }),
    );
    const { result } = renderHook(() =>
      usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections: [] }),
    );
    expect(result.current.pendingConnection).toEqual({
      id: 'conn_stored',
      externalId: 'org_org_1_stored',
    });
  });

  it('ignores corrupt or wrong-shaped session values and falls through to the list', () => {
    window.sessionStorage.setItem('pending-aws-connection:org_1:aws', 'not-json{');
    const { result, rerender } = renderHook(
      ({ connections }) =>
        usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections }),
      { initialProps: { connections: [] as ConnectionListItemResponse[] } },
    );
    expect(result.current.pendingConnection).toBeNull();

    window.sessionStorage.setItem(
      'pending-aws-connection:org_1:aws',
      JSON.stringify({ id: '', externalId: '' }),
    );
    rerender({ connections: [listRow({ id: 'from-list' })] });
    expect(result.current.pendingConnection).toEqual({
      id: 'from-list',
      externalId: 'org_org_1_issued',
    });
  });

  it('adopts a pending row that arrives after mount (late list load)', async () => {
    const { result, rerender } = renderHook(
      ({ connections }) =>
        usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections }),
      { initialProps: { connections: undefined as unknown as ConnectionListItemResponse[] } },
    );
    expect(result.current.pendingConnection).toBeNull();

    rerender({ connections: [listRow({ id: 'late' })] });
    await waitFor(() => {
      expect(result.current.pendingConnection).toEqual({
        id: 'late',
        externalId: 'org_org_1_issued',
      });
    });
  });

  it('persists set values and clears them without resurrection', async () => {
    const { result, rerender } = renderHook(
      ({ connections }) =>
        usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections }),
      { initialProps: { connections: [] as ConnectionListItemResponse[] } },
    );

    result.current.setPendingConnection({ id: 'conn_new', externalId: 'org_new' });
    await waitFor(() => {
      expect(result.current.pendingConnection).toEqual({
        id: 'conn_new',
        externalId: 'org_new',
      });
    });
    expect(window.sessionStorage.getItem('pending-aws-connection:org_1:aws')).toContain('conn_new');

    result.current.clearPendingConnection();
    await waitFor(() => {
      expect(result.current.pendingConnection).toBeNull();
    });
    expect(window.sessionStorage.getItem('pending-aws-connection:org_1:aws')).toBeNull();

    // A later refetch that still contains the row must not bring it back.
    rerender({ connections: [listRow({ id: 'conn_new', metadata: { externalId: 'org_new' } })] });
    await waitFor(() => {
      expect(result.current.pendingConnection).toBeNull();
    });
  });

  it('drops the stale value when the scope changes (org switch)', async () => {
    window.sessionStorage.setItem(
      'pending-aws-connection:org_1:aws',
      JSON.stringify({ id: 'conn_old', externalId: 'org_old' }),
    );
    window.sessionStorage.setItem(
      'pending-aws-connection:org_2:aws',
      JSON.stringify({ id: 'conn_new_org', externalId: 'org_new' }),
    );
    const { result, rerender } = renderHook(
      ({ orgId }) => usePendingAwsConnection({ orgId, providerId: 'aws', connections: [] }),
      { initialProps: { orgId: 'org_1' } },
    );
    expect(result.current.pendingConnection).toEqual({
      id: 'conn_old',
      externalId: 'org_old',
    });

    rerender({ orgId: 'org_2' });
    await waitFor(() => {
      expect(result.current.pendingConnection).toEqual({
        id: 'conn_new_org',
        externalId: 'org_new',
      });
    });
  });

  it('accepts a fresh mint after a dismissal in the same mount (second connect)', async () => {
    const { result } = renderHook(() =>
      usePendingAwsConnection({ orgId: 'org_1', providerId: 'aws', connections: [] }),
    );

    result.current.setPendingConnection({ id: 'conn_first', externalId: 'org_first' });
    await waitFor(() => {
      expect(result.current.pendingConnection).toEqual({
        id: 'conn_first',
        externalId: 'org_first',
      });
    });

    result.current.clearPendingConnection();
    await waitFor(() => {
      expect(result.current.pendingConnection).toBeNull();
    });

    // A second "Add Account" in the same mount must surface the new mint —
    // the earlier dismissal must not suppress it (or every retry mints an
    // orphan row while phase 2 stays unreachable).
    result.current.setPendingConnection({ id: 'conn_second', externalId: 'org_second' });
    await waitFor(() => {
      expect(result.current.pendingConnection).toEqual({
        id: 'conn_second',
        externalId: 'org_second',
      });
    });
  });
});
