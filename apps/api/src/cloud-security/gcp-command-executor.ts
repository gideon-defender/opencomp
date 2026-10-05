import { Logger } from '@nestjs/common';
import { SAFE_GCP_PROJECT_PATTERN } from '@gideon-defender/integration-platform';
import {
  buildEffectiveGcpStepUrl,
  decodeGcpPathToFixedPoint,
  decodedPathname,
  isGetIamPolicyUrl,
  isSetIamPolicyUrl,
} from './gcp-remediation-validator-shared';
import {
  checkGcpExecutionPreconditions,
  type GcpExecutorOptions,
} from './gcp-execution-preconditions';
import type { GcpApiStep } from './gcp-plan-step-validation';
import {
  redactGcpBodyForLog,
  redactGcpUrlForLog,
  sanitizeGcpPurposeForLog,
} from './gcp-remediation-plan.utils';

const logger = new Logger('GcpCommandExecutor');

const MAX_STEP_RETRIES = 3;
const MAX_POLL_MS = 120_000;
/**
 * Marker on terminal operation-poll failures. The poll status (e.g. 500)
 * would otherwise match the mutation retry branches below and re-issue
 * an already-accepted write — the marker makes the retry loop rethrow.
 */
const POLL_NO_RETRY_MARKER = 'not retrying the mutation';

/**
 * Server-controlled error text safe for logs: GCP errors echo member
 * emails (`user:alice@example.com`, `serviceAccount:x@y.iam.gserviceaccount.com`)
 * that must never reach log storage. Retry and dispatch matching below
 * runs on the raw text — sanitize only at the log boundary, and keep the
 * returned message intact so callers still see the API's cause.
 */
export function sanitizeGcpErrorForLog(message: string): string {
  return message
    .replace(/[\r\n]+/g, ' ')
    .replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      '[redacted-email]',
    )
    .slice(0, 500);
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface GcpStepResult {
  step: GcpApiStep;
  output: Record<string, unknown>;
}

interface GcpExecutionResult {
  results: GcpStepResult[];
  error?: {
    stepIndex: number;
    // Optional for the same reason as GcpPreconditionFailure.step:
    // plan-level refusals name no single step.
    step?: GcpApiStep;
    message: string;
  };
}

// ─── Multi-Step Execution ──────────────────────────────────────────────────

/**
 * Execute GCP API steps sequentially with self-healing:
 * - Retries on 429 throttling and 5xx server errors
 * - Auto-enables disabled GCP APIs
 * - Polls long-running operations
 * - Auto-rolls back on partial failure
 */
export async function executeGcpPlanSteps(
  params: GcpExecutorOptions,
): Promise<GcpExecutionResult> {
  // All pre-execution gates live in `gcp-execution-preconditions`: URL
  // validation, read/rollback refusal, and 1:1 rollback pairing.
  const blocked = checkGcpExecutionPreconditions(params);
  if (blocked) {
    return {
      results: [],
      error: {
        stepIndex: blocked.stepIndex,
        step: blocked.step,
        message: blocked.message,
      },
    };
  }

  const results: GcpStepResult[] = [];

  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    try {
      const output = await executeWithRetry({
        step,
        accessToken: params.accessToken,
        ...(params.isRollback ? { isRollback: true } : {}),
        ...(params.isRead ? { isRead: true } : {}),
      });
      results.push({ step, output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Log the query-stripped URL: query strings can carry credentials.
      // The message is server-controlled and can echo member emails —
      // sanitize it before it reaches log storage.
      logger.error(
        `Step ${i + 1} failed: ${step.method} ${redactGcpUrlForLog(step.url)} — ${sanitizeGcpErrorForLog(message)}`,
      );

      // Auto-rollback completed steps
      if (
        params.autoRollbackSteps &&
        params.autoRollbackSteps.length > 0 &&
        i > 0
      ) {
        logger.log(`Auto-rolling back ${i} completed steps...`);
        for (
          let j = Math.min(i - 1, params.autoRollbackSteps.length - 1);
          j >= 0;
          j--
        ) {
          // A fix step that 409'd (`_alreadyExists`) created nothing — its
          // rollback would delete or revert a pre-existing resource the fix
          // never touched. Skip compensation for those positions.
          if (results[j]?.output?._alreadyExists === true) {
            logger.log(
              `Skipping rollback step ${j}: fix step already existed, nothing to undo`,
            );
            continue;
          }
          try {
            await executeWithRetry({
              step: params.autoRollbackSteps[j],
              accessToken: params.accessToken,
              isRollback: true,
            });
            logger.log(`Rollback step ${j} succeeded`);
          } catch (rbErr) {
            logger.warn(
              `Rollback step ${j} failed: ${sanitizeGcpErrorForLog(rbErr instanceof Error ? rbErr.message : String(rbErr))}`,
            );
          }
        }
      }

      return { results, error: { stepIndex: i, step, message } };
    }
  }

  return { results };
}

// ─── Single Step with Retry ────────────────────────────────────────────────

async function executeWithRetry(args: {
  step: GcpApiStep;
  accessToken: string;
  isRollback?: boolean;
  /**
   * Read executions run pre-acknowledgment with the auditor token: retry
   * paths that mutate remote state are disabled — see the
   * `services:enable` block below.
   */
  isRead?: boolean;
}): Promise<Record<string, unknown>> {
  const { step, accessToken } = args;
  if (step.method === 'DELETE' && !args.isRollback) {
    throw new Error(
      `DELETE operations are blocked for safety. Step: ${sanitizeGcpPurposeForLog(step.purpose)}`,
    );
  }

  for (let attempt = 0; attempt < MAX_STEP_RETRIES; attempt++) {
    try {
      return await executeOnce(step, accessToken);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const canRetry = attempt < MAX_STEP_RETRIES - 1;

      // Poll failures must never re-execute the mutation: the first
      // request may already have applied server-side, so retrying the
      // step double-applies (or masks unknown state as a fresh attempt).
      // Transient poll errors already retry inside the poll loop — what
      // reaches here is terminal and fails the step.
      if (msg.includes(POLL_NO_RETRY_MARKER)) {
        throw error;
      }

      // 429 Throttled → wait and retry
      if (msg.includes('429') && canRetry) {
        const delay = 3000 * (attempt + 1);
        logger.warn(
          `Throttled (429), waiting ${delay}ms before retry ${attempt + 1}`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // 5xx Server error → wait and retry. Match the status group this
      // module always embeds (`GCP API error (<status>)`), not free-text
      // digits: a resource name like `project-5001` must not re-issue a
      // write that will fail identically.
      if (/GCP API error \(50[0-9]\)/.test(msg) && canRetry) {
        logger.warn(`Server error, retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // API not enabled → auto-enable and retry. The API name is taken
      // from untrusted error text (it can reflect resource names), so it
      // must equal the step's own hostname — enabling any other API named
      // in an error would turn reflected input into a billable,
      // config-changing `services:enable` write outside the allowlist.
      // Reads never auto-enable: read executions run pre-acknowledgment
      // with the auditor token, so a `services:enable` write there would
      // execute a billable config change outside every gate. Fail the
      // read instead — the fix path retries with the write identity.
      if (
        (msg.includes('has not been used') ||
          msg.includes('is not enabled') ||
          msg.includes('SERVICE_DISABLED')) &&
        canRetry &&
        !args.isRead
      ) {
        const apiMatch = msg.match(/([\w.-]+\.googleapis\.com)/);
        let stepHost: string | undefined;
        try {
          stepHost = new URL(step.url).hostname.toLowerCase();
        } catch {
          stepHost = undefined;
        }
        if (apiMatch && stepHost && apiMatch[1].toLowerCase() === stepHost) {
          const enabled = await enableGcpApi(
            accessToken,
            step.url,
            apiMatch[1],
          );
          // A failed enablement would fail identically on retry — surface
          // it now instead of burning attempts and hiding the cause behind
          // the original SERVICE_DISABLED error.
          if (!enabled) {
            throw new Error(
              `GCP API ${apiMatch[1]} is not enabled and auto-enablement failed — enable it manually and retry. Step: ${sanitizeGcpPurposeForLog(step.purpose)}`,
            );
          }
          continue;
        }
      }

      // Resource in progress → wait and retry
      if (
        (msg.includes('RESOURCE_IN_USE') ||
          msg.includes('already being') ||
          msg.includes('operation is in progress')) &&
        canRetry
      ) {
        logger.warn('Resource busy, waiting 10s...');
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }

      // Not retryable → throw
      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

// ─── Single API Call ───────────────────────────────────────────────────────

/**
 * True when a step URL targets CRM v1 projects. Compares the lowercased
 * hostname and the decoded pathname so encoded or uppercase variants
 * upgrade exactly when the guards treat them as IAM policy URLs.
 */
function isCrmV1IamPolicyUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname !== 'cloudresourcemanager.googleapis.com') return false;
  const pathname = decodedPathname(url);
  if (pathname === undefined) return false;
  return pathname.includes('/v1/projects/');
}

async function executeOnce(
  step: GcpApiStep,
  accessToken: string,
): Promise<Record<string, unknown>> {
  // The fetched URL is the canonical effective URL — the same builder the
  // validators check, so validated and executed strings cannot diverge.
  let url = buildEffectiveGcpStepUrl(step);

  // Auto-upgrade CRM v1 IAM policy URLs to v3 (v1 silently drops auditConfigs).
  // Match AND patch on the canonical decoded pathname — the same string the
  // guards see. A raw substring replace on the effective URL misses
  // `%2F`-encoded or case-variant paths that the decoded guard matched, so
  // the replace becomes a no-op and the step runs as v1. Rebuilding through
  // the URL object keeps the query string and re-encodes the path.
  if (
    isCrmV1IamPolicyUrl(step.url) &&
    (isGetIamPolicyUrl(step.url) || isSetIamPolicyUrl(step.url))
  ) {
    try {
      const parsed = new URL(url);
      const decoded = decodeGcpPathToFixedPoint(parsed.pathname);
      if (decoded !== undefined) {
        const upgraded = decoded.replace('/v1/projects/', '/v3/projects/');
        if (upgraded !== decoded) {
          parsed.pathname = upgraded;
          url = parsed.toString();
        }
      }
    } catch {
      // Unparseable URLs are refused by validation before execution.
    }
  }

  // Auto-inject requestedPolicyVersion: 3 for getIamPolicy calls
  // Without this, GCP returns v1 policies that omit auditConfigs and conditions.
  // Match on the decoded pathname (same string the guards see): a raw
  // substring check misses `%3A`-encoded actions and downgrades the read
  // that grounds the IAM guard.
  let effectiveBody = step.body;
  if (
    step.method === 'POST' &&
    isGetIamPolicyUrl(step.url) &&
    (!step.body || !step.body.options)
  ) {
    effectiveBody = {
      ...step.body,
      options: { requestedPolicyVersion: 3 },
    };
  }

  logger.log(
    `${step.method} ${redactGcpUrlForLog(url)} — ${sanitizeGcpPurposeForLog(step.purpose)}`,
  );
  if (
    effectiveBody &&
    (step.method === 'POST' || step.method === 'PUT' || step.method === 'PATCH')
  ) {
    // Never log raw bodies: IAM bindings hold member emails and etags.
    // Log the redacted shape (sensitive keys become `[redacted]`).
    const redacted = redactGcpBodyForLog(effectiveBody);
    const bodyStr = JSON.stringify(redacted);
    logger.debug(
      `  Body (${bodyStr.length} chars): ${bodyStr.substring(0, 2000)}${bodyStr.length > 2000 ? '...' : ''}`,
    );
  }

  // Never follow redirects: the bearer token rides on this request, so a
  // 302 to an attacker host would leak it cross-origin. GCP APIs answer
  // directly — a redirect is unexpected and fails closed as an error.
  const response = await fetch(url, {
    method: step.method,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: effectiveBody ? JSON.stringify(effectiveBody) : undefined,
  });

  if (!response.ok) {
    return handleErrorResponse(response, step);
  }

  if (response.status === 204) {
    return { success: true };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return { success: true };
  }

  // Poll long-running operations
  if (isGcpOperation(data)) {
    return waitForOperation(data, accessToken);
  }

  return data;
}

async function handleErrorResponse(
  response: Response,
  step: GcpApiStep,
): Promise<Record<string, unknown>> {
  let errorBody: Record<string, unknown> = {};
  const rawText = await response.text();
  try {
    errorBody = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    errorBody = { message: rawText };
  }

  const gcpError = errorBody.error as Record<string, unknown> | undefined;
  const errorMessage =
    (gcpError?.message as string) ?? JSON.stringify(errorBody).slice(0, 500);
  const errorStatus = (gcpError?.status as string) ?? '';

  // 409 = already exists → success only for create-style POSTs. A 409
  // on PATCH/PUT/DELETE means a precondition or version conflict rejected
  // the write, so recording it as applied would silently skip the
  // mutation and let dependent steps build on a change that never landed.
  if (response.status === 409 || errorStatus === 'ALREADY_EXISTS') {
    if (step.method !== 'POST') {
      throw new Error(
        `GCP API error (${response.status}): ${step.method} write rejected (conflict) — ${errorMessage}`,
      );
    }
    logger.log(
      `Already exists (success): ${sanitizeGcpPurposeForLog(step.purpose)}`,
    );
    return { _alreadyExists: true, status: 409 };
  }

  // 404 on GET = resource not found (useful for read steps)
  if (response.status === 404 && step.method === 'GET') {
    return { _notFound: true, status: 404 };
  }

  if (response.status === 401) {
    throw new Error(
      'GCP authentication failed. Access token may have expired. Please reconnect.',
    );
  }

  if (response.status === 403 || errorStatus === 'PERMISSION_DENIED') {
    throw new Error(`Permission denied: ${errorMessage}`);
  }

  // Include status code in error for retry logic detection
  throw new Error(`GCP API error (${response.status}): ${errorMessage}`);
}

// ─── GCP API Auto-Enable ─────────────────────────────────────────────────

async function enableGcpApi(
  accessToken: string,
  stepUrl: string,
  apiName: string,
): Promise<boolean> {
  // Extract project ID from the step URL pathname only — the query string
  // is AI-controlled, so matching the raw URL would let `?x=/projects/evil`
  // select the project for a billable `services:enable` write.
  let projectId: string | undefined;
  try {
    const pathname = new URL(stepUrl).pathname;
    projectId = pathname.match(/\/projects\/([^/?#]+)/)?.[1];
  } catch {
    projectId = undefined;
  }
  if (!projectId) {
    logger.warn(`Cannot extract project ID from URL to enable API: ${apiName}`);
    return false;
  }
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    logger.warn(
      `Refusing to auto-enable API for unexpected project segment: ${apiName}`,
    );
    return false;
  }

  logger.log(`Auto-enabling GCP API: ${apiName} in project ${projectId}`);
  try {
    const resp = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${apiName}:enable`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (resp.ok || resp.status === 409) {
      logger.log(`API ${apiName} enabled — waiting 10s for propagation`);
      await new Promise((r) => setTimeout(r, 10_000));
      return true;
    }
    logger.warn(`Failed to enable ${apiName}: ${resp.status}`);
    return false;
  } catch (err) {
    logger.warn(
      `API enablement error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

// ─── Long-Running Operation Polling ────────────────────────────────────────

/**
 * Throw when a terminal (DONE) operation payload reports failure. Some GCP
 * operation flavors carry `error.errors[]`, others report a bare
 * `error: {code, message}` — both must fail the step. A DONE payload with
 * an error shape the code does not recognize is a failure, never success.
 */
function throwIfGcpOperationFailed(operation: Record<string, unknown>): void {
  if (!operation.error) return;
  const errObj = operation.error as Record<string, unknown>;
  const errors = errObj.errors as Array<{ message: string }> | undefined;
  if (errors?.length) {
    throw new Error(`GCP operation failed: ${errors[0].message}`);
  }
  const message =
    typeof errObj.message === 'string' && errObj.message.length > 0
      ? errObj.message
      : `operation reported an error: ${JSON.stringify(errObj).slice(0, 300)}`;
  throw new Error(`GCP operation failed: ${message}`);
}

function isGcpOperation(data: Record<string, unknown>): boolean {
  const kind = data.kind as string | undefined;
  if (kind && kind.includes('#operation')) return true;
  if (data.operationType && data.status) return true;
  return false;
}

async function waitForOperation(
  operation: Record<string, unknown>,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const selfLink = operation.selfLink as string;
  if (!selfLink) {
    // No poll target and no terminal state is unknown remote state — it
    // must fail the step, never record success. A DONE payload without a
    // selfLink is already terminal, so it goes through the same
    // error-shape check as a polled result instead of failing outright.
    if (operation.status === 'DONE') {
      throwIfGcpOperationFailed(operation);
      return operation;
    }
    throw new Error(
      'GCP operation has no selfLink and is not DONE — remote state is unknown, failing the step instead of recording success',
    );
  }

  // Validate selfLink URL to prevent SSRF via response data. The bearer
  // token rides on the poll request, so plain HTTP would leak it in
  // cleartext — require HTTPS, not just the right host. Failures throw:
  // returning the unpolled operation as success would record an unknown
  // remote state as a completed step.
  try {
    const parsed = new URL(selfLink);
    if (parsed.protocol !== 'https:') {
      throw new Error('Operation selfLink must use HTTPS');
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'googleapis.com' && !host.endsWith('.googleapis.com')) {
      throw new Error(`Operation selfLink targets disallowed host: ${host}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Operation selfLink')
    ) {
      throw error;
    }
    throw new Error('Operation selfLink is malformed');
  }

  const startTime = Date.now();
  let pollInterval = 2000;

  while (Date.now() - startTime < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, pollInterval));
    pollInterval = Math.min(pollInterval * 1.5, 10_000);

    const resp = await fetch(selfLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    });

    // A failed poll leaves the remote state unknown — the step must fail,
    // never record success. Transient poll errors (429/5xx) retry the
    // poll itself inside this loop: the mutation already went out, so
    // surfacing them to the caller would re-execute an accepted write.
    if (!resp.ok) {
      const transient =
        resp.status === 429 || /50[0-9]/.test(String(resp.status));
      if (transient && Date.now() - startTime < MAX_POLL_MS) {
        logger.warn(
          `GCP operation poll failed (${resp.status}), retrying poll...`,
        );
        continue;
      }
      throw new Error(
        `GCP operation poll failed (${resp.status}) — remote state is unknown, ${POLL_NO_RETRY_MARKER}`,
      );
    }

    const updated = (await resp.json()) as Record<string, unknown>;
    if (updated.status === 'DONE') {
      throwIfGcpOperationFailed(updated);
      return updated;
    }
  }

  throw new Error(
    `GCP operation did not complete within ${MAX_POLL_MS}ms — state is unknown, ${POLL_NO_RETRY_MARKER}`,
  );
}
