import { HttpException, Type } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { db } from '@db';
import { ActingUserResolver } from '../auth/acting-user.service';
import type { AuthenticatedRequest } from '../auth/types';
import { RESOURCE_TO_ENTITY_TYPE } from '../audit/audit-log.constants';
import { buildDescription } from '../audit/audit-log.utils';

/**
 * In-process Nest context for trigger tasks.
 *
 * API-side trigger workers run in the SAME process as the API (registered via
 * `initLocalTriggerRuntime()` in main.ts, backed by BullMQ). They used to call
 * back into the API over HTTP (`fetch(${BASE_URL}/v1/...)`) with
 * `x-service-token` — a loopback that costs a socket, a timeout, and a secret
 * for zero network isolation. Resolving the controller/service from the Nest
 * container instead removes the hop entirely while keeping the exact same
 * handler logic (validation, errors, audit attribution).
 *
 * Cross-process callers (Next.js app workers, portal) still use HTTP + the
 * service token — the routes and guards are unchanged.
 */

/**
 * Service name attributed to in-process trigger calls. Matches the
 * `trigger` service definition in `auth/service-token.config.ts`, so the
 * `via service "Local trigger Workers"` caller label is identical to the
 * old HTTP loopback path (where HybridAuthGuard set it from the token).
 */
export const TRIGGER_SERVICE_NAME = 'Local trigger Workers';

let appRef: INestApplication | null = null;

/** Called once at API bootstrap (main.ts) after the Nest app is created. */
export function setTriggerNestContext(app: INestApplication): void {
  appRef = app;
}

export function isTriggerNestContextReady(): boolean {
  return appRef !== null;
}

/**
 * Resolve a controller or service from the Nest container.
 * Throws when called before bootstrap (e.g. in unit tests without the app) —
 * specs should `jest.mock` this module.
 */
export function getTriggerService<T>(token: Type<T>): T {
  if (!appRef) {
    throw new Error(
      'Trigger Nest context is not initialized. Ensure setTriggerNestContext() runs at API bootstrap before trigger workers execute.',
    );
  }
  return appRef.get(token, { strict: false });
}

/**
 * Extract a human-readable message from a directly-invoked handler error.
 * Replaces the old `response.json().message` parsing of the HTTP loopback.
 */
export function triggerHttpErrorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.map(String).join('; ');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Extract the HTTP status from a directly-invoked handler error. */
export function triggerHttpErrorStatus(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  return 500;
}

/**
 * Synthesize the request object a service-token caller would have produced.
 * Lets directly-invoked handlers keep their audit attribution
 * (`ActingUserResolver` falls back to the org owner with a
 * `via service "<name>"` caller label — identical to the HTTP path).
 */
export function createServiceTriggerRequest(params: {
  organizationId: string;
  serviceName: string;
}): AuthenticatedRequest {
  return Object.assign(new Request('http://localhost'), {
    organizationId: params.organizationId,
    authType: 'service' as const,
    isApiKey: false,
    isServiceToken: true,
    serviceName: params.serviceName,
    isPlatformAdmin: false,
    userRoles: null,
  });
}

/** Same method→action mapping the AuditLogInterceptor uses. */
const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'create',
  GET: 'read',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

export interface TriggerAuditParams {
  organizationId: string;
  /** Permission resource of the invoked handler (e.g. 'integration'). */
  resource: string;
  /** HTTP method the old loopback used (e.g. 'POST'). */
  method: string;
  /** Request path the old loopback used (e.g. '/v1/cloud-security/scan/conn_1'). */
  path: string;
}

/**
 * Write the audit row the global AuditLogInterceptor would have written for
 * the old HTTP loopback call. Direct in-process handler calls never enter the
 * Nest pipeline, so without this the scheduled run silently drops out of the
 * audit trail. Mirrors the interceptor's row shape (description, `via`
 * caller label, entity type) and its skip rules: only successful handler
 * returns reach here (callers must invoke this after the call, not in a
 * catch block), and unattributable orgs (no owner) are skipped.
 *
 * Best-effort: failures are swallowed so audit can never break a worker.
 */
export async function logTriggerAuditEntry(
  params: TriggerAuditParams,
): Promise<void> {
  try {
    const request = createServiceTriggerRequest({
      organizationId: params.organizationId,
      serviceName: TRIGGER_SERVICE_NAME,
    });
    const acting = await getTriggerService(ActingUserResolver).resolve(
      request,
      params.organizationId,
    );
    if (!acting.userId) return;

    const action = METHOD_TO_ACTION[params.method] ?? 'update';
    const description = buildDescription(
      params.method,
      action,
      params.resource,
    );
    const finalDescription = acting.callerLabel
      ? `${description} [${acting.callerLabel}]`
      : description;

    await db.auditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: acting.userId,
        memberId: acting.memberId ?? null,
        entityType: RESOURCE_TO_ENTITY_TYPE[params.resource] ?? null,
        entityId: null,
        description: finalDescription,
        data: {
          action: description,
          method: params.method,
          path: params.path,
          resource: params.resource,
          permission: action,
          ...(acting.callerLabel ? { via: acting.callerLabel } : {}),
        },
      },
    });
  } catch {
    // Audit is best-effort — never fail the worker over a missing row.
  }
}
