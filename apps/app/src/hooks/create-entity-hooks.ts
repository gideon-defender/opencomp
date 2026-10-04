'use client';

import type { ApiResponse } from '@/lib/api-client';
import { useCallback } from 'react';
import { useApi } from './use-api';
import { useApiSWR, UseApiSWROptions } from './use-api-swr';

// Default polling intervals
export const DEFAULT_POLLING_INTERVAL = 5000;
export const DEFAULT_LIST_INTERVAL = 30000;

export type EntityHooksOptions<ListResponse> = UseApiSWROptions<ListResponse> & {
  initialData?: unknown;
};

export type SingleEntityOptions<EntityResponse> = UseApiSWROptions<EntityResponse> & {
  initialData?: EntityResponse;
};

type CreateEntityHooksConfig = {
  basePath: string;
  defaultListInterval?: number;
  defaultItemInterval?: number;
};

/**
 * Factory for SWR entity hooks.
 * Deduplicates useVendors/useRisks/useTaskItems pattern:
 * - List hook with fallbackData hydation
 * - Single hook with polling + vendor/risk extraction
 * - CRUD actions with api.post/patch/delete + error throw
 *
 * @example
 * export const { useList: useVendors, useOne: useVendor, useActions: useVendorActions } =
 *   createEntityHooks<Vendor, VendorsResponse, CreateVendorData, UpdateVendorData>({ basePath: '/v1/vendors' });
 */
export function createEntityHooks<
  Entity extends { id: string },
  ListResponse,
  CreateData,
  UpdateData,
  EntityResponse extends Entity = Entity,
>(config: CreateEntityHooksConfig) {
  const {
    basePath,
    defaultListInterval = DEFAULT_LIST_INTERVAL,
    defaultItemInterval = DEFAULT_POLLING_INTERVAL,
  } = config;

  function useList(
    options: EntityHooksOptions<ListResponse> & {
      initialData?: unknown;
      buildEndpoint?: (q: unknown) => string;
    } = {},
  ) {
    const { initialData, buildEndpoint, ...restOptions } = options as Record<string, unknown> & {
      buildEndpoint?: (q: unknown) => string;
    };
    // For simple list without query, allow custom endpoint via buildEndpoint or default basePath
    const endpoint =
      typeof buildEndpoint === 'function'
        ? (buildEndpoint as (q: unknown) => string)(options)
        : basePath;

    return useApiSWR<ListResponse>(endpoint, {
      ...restOptions,
      refreshInterval:
        (restOptions as { refreshInterval?: number }).refreshInterval ?? defaultListInterval,
      ...(initialData
        ? {
            fallbackData: {
              data: {
                data: initialData,
                count: Array.isArray(initialData) ? (initialData as unknown[]).length : 0,
              } as unknown as ListResponse,
              status: 200,
            } as ApiResponse<ListResponse>,
          }
        : {}),
    } as UseApiSWROptions<ListResponse>);
  }

  function useOne(id: string | null, options: SingleEntityOptions<EntityResponse> = {}) {
    const { initialData, ...restOptions } = options;
    const swrResult = useApiSWR<EntityResponse>(id ? `${basePath}/${id}` : null, {
      ...restOptions,
      refreshInterval:
        (restOptions as { refreshInterval?: number }).refreshInterval ?? defaultItemInterval,
      refreshWhenHidden: false,
      ...(initialData
        ? {
            fallbackData: {
              data: initialData,
              status: 200,
            } as ApiResponse<EntityResponse>,
          }
        : {}),
    } as UseApiSWROptions<EntityResponse>);

    return {
      ...swrResult,
      data: swrResult.data?.data ?? null,
      entity: swrResult.data?.data ?? null,
    };
  }

  function useActions() {
    const api = useApi();

    const create = useCallback(
      async (data: CreateData) => {
        const response = await api.post<Entity>(basePath, data);
        if (response.error) throw new Error(response.error);
        return response.data!;
      },
      [api],
    );

    const update = useCallback(
      async (id: string, data: UpdateData) => {
        const response = await api.patch<Entity>(`${basePath}/${id}`, data);
        if (response.error) throw new Error(response.error);
        return response.data!;
      },
      [api],
    );

    const remove = useCallback(
      async (id: string) => {
        const response = await api.delete(`${basePath}/${id}`);
        if (response.error) throw new Error(response.error);
        return { success: true, status: response.status };
      },
      [api],
    );

    return {
      create,
      update,
      remove,
      createEntity: create,
      updateEntity: update,
      deleteEntity: remove,
    };
  }

  return { useList, useOne, useActions, useEntityActions: useActions };
}

/**
 * Lightweight list hook for simple CRUD resources that return `{ data: T[], count }`
 * and need only `fallbackData` hydration. Replaces ~15 copies of
 * `useSWR(key, () => apiClient.get(...), { fallbackData, revalidateOnMount })`.
 *
 * Keeps the existing consumer contract (`{ data: T[], isLoading, error, mutate }`)
 * while single-sourcing the SWR boilerplate.
 */
export function createSimpleListHook<ListItem, ListResponse extends { data: ListItem[] }>(
  endpoint: string,
  defaultInterval = DEFAULT_LIST_INTERVAL,
) {
  return function useSimpleList(
    options?: { initialData?: ListItem[] } & UseApiSWROptions<ListResponse>,
  ) {
    const { initialData, ...restOptions } = (options ?? {}) as {
      initialData?: ListItem[];
    } & UseApiSWROptions<ListResponse>;
    const swr = useApiSWR<ListResponse>(endpoint, {
      refreshInterval:
        (restOptions as { refreshInterval?: number }).refreshInterval ?? defaultInterval,
      revalidateOnFocus: false,
      ...(restOptions as object),
      ...(initialData
        ? {
            fallbackData: {
              data: { data: initialData, count: initialData.length } as unknown as ListResponse,
              status: 200,
            } as ApiResponse<ListResponse>,
          }
        : {}),
      revalidateOnMount: initialData ? false : true,
    } as UseApiSWROptions<ListResponse>);

    // Unwrap ApiResponse<ListResponse> -> ListItem[]
    const raw = swr.data as unknown as ApiResponse<ListResponse> | undefined;
    const listResponse = raw?.data as ListResponse | undefined;
    const data = (listResponse as { data?: ListItem[] })?.data ?? [];
    const list = Array.isArray(data) ? data : [];

    return {
      data: list,
      error: swr.error,
      isLoading: swr.isLoading,
      mutate: swr.mutate,
      raw: listResponse,
      swr,
    };
  };
}

/**
 * Factory for Trigger orchestration helpers (auto-link, relink, mitigation).
 * Deduplicates 8-method blocks in useVendors/useRisks:
 *   regenerateMitigation, autoLink, relink, suggestLinks, applyLinks, fetchActiveRun, discardRun
 */
export function createLinkageActions(resource: string) {
  const base = `/api/${resource}`;

  const triggerPost = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'include',
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' } as Record<string, string>,
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to trigger ${path}`);
    }
    return response.json() as Promise<{ runId: string; publicAccessToken: string }>;
  };

  return {
    regenerateMitigation: (id: string) => triggerPost(`/${id}/regenerate-mitigation`),
    autoLink: (id: string) => triggerPost(`/${id}/auto-link`),
    relink: (id: string) => triggerPost(`/${id}/relink`),
    suggestLinks: (id: string) => triggerPost(`/${id}/auto-link`),
    applyLinks: (id: string, params: { taskIds: string[]; replace: boolean }) =>
      fetch(`${base}/${id}/auto-link/apply`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }).then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || 'Failed to apply suggestions');
        }
      }),
    fetchActiveRun: async (id: string) => {
      const response = await fetch(`${base}/${id}/auto-link/active`, { credentials: 'include' });
      if (!response.ok) return null;
      const body = (await response.json()) as
        { runId: string; publicAccessToken: string } | { runId: null };
      if (!body.runId) return null;
      return body as { runId: string; publicAccessToken: string };
    },
    discardRun: (id: string) =>
      fetch(`${base}/${id}/auto-link/active`, { method: 'DELETE', credentials: 'include' }).catch(
        () => {},
      ),
  };
}
