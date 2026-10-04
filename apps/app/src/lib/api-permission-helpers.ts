import { NextResponse } from 'next/server';
import { requireApiPermission } from './permissions.server';

/**
 * Wraps a Route Handler with permission check.
 * Replaces:
 *   const ctx = await requireApiPermission(req, 'risk', 'update');
 *   if (ctx instanceof NextResponse) return ctx;
 *
 * With:
 *   const ctx = await getApiPermissionContext(req, 'risk', 'update');
 *   if (!ctx) return; // already returned 401/403
 *
 * Or use `withApiPermission` for full wrapping.
 */

export async function getApiPermissionContext(req: Request, resource: string, action: string) {
  const result = await requireApiPermission(req, resource, action);
  if (result instanceof NextResponse) {
    return { response: result as NextResponse, context: null as never };
  }
  return { response: null, context: result };
}

/**
 * Higher-order handler that enforces permission before invoking the wrapped handler.
 *
 * @example
 * export const POST = withApiPermission('risk', 'update', async (req, { organizationId }) => {
 *   // organizationId is guaranteed to be authorized
 * });
 */
export function withApiPermission(
  resource: string,
  action: string,
  handler: (
    req: Request,
    ctx: { organizationId: string; userId: string; permissions: Record<string, string[]> },
  ) => Promise<Response>,
) {
  return async (req: Request): Promise<Response> => {
    const result = await requireApiPermission(req, resource, action);
    if (result instanceof NextResponse) return result;
    return handler(req, result);
  };
}
