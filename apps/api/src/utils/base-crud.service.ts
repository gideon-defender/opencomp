import { Logger, NotFoundException } from '@nestjs/common';

export type PaginationQuery = {
  page?: number;
  perPage?: number;
  sort?: string;
  sortDirection?: 'asc' | 'desc';
};

export type PaginatedResult<T> = {
  data: T[];
  totalCount: number;
  page: number;
  pageCount: number;
};

/**
 * Generic pagination helper.
 * Replaces:
 *   const [rows, total] = await Promise.all([db.table.findMany({ skip, take }), db.table.count({ where })])
 *   const pageCount = Math.ceil(total / perPage);
 *
 * Used in RisksService:85-113, VendorsService:93-130, ControlsService:83-97, ContextService:22-42
 */
export async function paginate<T>(params: {
  model: {
    findMany: (args: unknown) => Promise<T[]>;
    count: (args: unknown) => Promise<number>;
  };
  where: unknown;
  page?: number;
  perPage?: number;
  orderBy?: unknown;
  include?: unknown;
  select?: unknown;
}): Promise<PaginatedResult<T>> {
  const {
    model,
    where,
    page = 1,
    perPage = 50,
    orderBy,
    include,
    select,
  } = params;
  const skip = (page - 1) * perPage;
  const take = perPage;

  const [data, totalCount] = await Promise.all([
    model.findMany({ where, skip, take, orderBy, include, select }),
    model.count({ where }),
  ]);

  const pageCount = Math.ceil(totalCount / perPage);

  return { data, totalCount, page, pageCount };
}

export function handleServiceError(
  logger: Logger,
  context: string,
  error: unknown,
): never {
  if (error instanceof NotFoundException) throw error;
  logger.error(`Failed to ${context}:`, error as Error);
  throw error as Error;
}

export function buildOrderBy(sort?: string, sortDirection?: string) {
  if (!sort) return undefined;
  return { [sort]: sortDirection ?? 'desc' } as Record<string, string>;
}

export function notFoundError(
  entity: string,
  id: string,
  organizationId: string,
): never {
  throw new NotFoundException(
    `${entity} with ID ${id} not found in organization ${organizationId}`,
  );
}

/**
 * Tenant-scoped where helper.
 * Replaces `where: { organizationId }` 100+ occurrences.
 */
export function scopedWhere(
  organizationId: string,
  extra: Record<string, unknown> = {},
) {
  return { organizationId, ...extra } as Record<string, unknown>;
}

export function scopedWhereWithId(id: string, organizationId: string) {
  return { id, organizationId } as Record<string, unknown>;
}
