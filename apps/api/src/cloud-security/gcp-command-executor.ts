import { Logger } from '@nestjs/common';
import {
  GCP_NEVER_ALLOW_PERMISSIONS,
  SAFE_GCP_PROJECT_PATTERN,
  gcpRollbackDeletePrefixAllowed,
  isGcpAllowlistedFixStep,
  type GcpRemediationAssetClass,
} from '@gideon-defender/integration-platform';

const logger = new Logger('GcpCommandExecutor');

const MAX_STEP_RETRIES = 3;
const MAX_POLL_MS = 120_000;

// ─── Types ─────────────────────────────────────────────────────────────────

interface GcpApiStep {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  purpose: string;
}

interface GcpStepResult {
  step: GcpApiStep;
  output: Record<string, unknown>;
}

interface GcpExecutionResult {
  results: GcpStepResult[];
  error?: {
    stepIndex: number;
    step: GcpApiStep;
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
export async function executeGcpPlanSteps(params: {
  steps: GcpApiStep[];
  accessToken: string;
  autoRollbackSteps?: GcpApiStep[];
  isRollback?: boolean;
  /**
   * When provided with `enforceAllowlist`, fix/rollback steps are also
   * checked against the asset-class allowlist — not just the URL shape.
   * Callers executing writes must pass the finding's asset class so
   * AI-generated rollback steps cannot bypass the allowlist on the
   * auto-rollback path.
   */
  assetClass?: GcpRemediationAssetClass;
  enforceAllowlist?: boolean;
}): Promise<GcpExecutionResult> {
  // Validate ALL step URLs before executing any — prevents SSRF on read/fix/rollback steps.
  // Fix steps and rollback steps validate under different flags: rollback
  // steps allow DELETE (prefix-scoped), fix steps never do.
  const baseOpts = {
    ...(params.assetClass ? { assetClass: params.assetClass } : {}),
    ...(params.enforceAllowlist ? { enforceAllowlist: true } : {}),
  };
  const validationErrors = [
    ...validateGcpPlanSteps(params.steps, {
      ...baseOpts,
      ...(params.isRollback ? { isRollback: true } : {}),
    }),
    ...validateGcpPlanSteps(params.autoRollbackSteps ?? [], {
      ...baseOpts,
      isRollback: true,
    }),
  ];
  if (validationErrors.length > 0) {
    return {
      results: [],
      error: {
        stepIndex: 0,
        step: params.steps[0] ?? params.autoRollbackSteps?.[0],
        message: `URL validation failed: ${validationErrors.join('; ')}`,
      },
    };
  }

  // The auto-rollback loop below compensates by position
  // (rollback[j] undoes fix step j), so the two arrays must line up 1:1.
  // Anything else would roll back the wrong subset — refuse instead of
  // executing a plan whose compensation does not match its writes.
  if (
    params.autoRollbackSteps &&
    params.autoRollbackSteps.length !== params.steps.length
  ) {
    return {
      results: [],
      error: {
        stepIndex: 0,
        step: params.steps[0] ?? params.autoRollbackSteps?.[0],
        message:
          `Rollback mismatch: ${params.autoRollbackSteps.length} rollback steps ` +
          `for ${params.steps.length} fix steps. Refusing to execute without 1:1 compensation.`,
      },
    };
  }

  const results: GcpStepResult[] = [];

  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    try {
      const output = await executeWithRetry(
        step,
        params.accessToken,
        params.isRollback,
      );
      results.push({ step, output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Step ${i + 1} failed: ${step.method} ${step.url} — ${message}`,
      );

      // Auto-rollback completed steps
      if (params.autoRollbackSteps && i > 0) {
        logger.log(`Auto-rolling back ${i} completed steps...`);
        for (
          let j = Math.min(i - 1, params.autoRollbackSteps.length - 1);
          j >= 0;
          j--
        ) {
          try {
            await executeWithRetry(
              params.autoRollbackSteps[j],
              params.accessToken,
              true,
            );
            logger.log(`Rollback step ${j} succeeded`);
          } catch (rbErr) {
            logger.warn(
              `Rollback step ${j} failed: ${rbErr instanceof Error ? rbErr.message : String(rbErr)}`,
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

async function executeWithRetry(
  step: GcpApiStep,
  accessToken: string,
  isRollback?: boolean,
): Promise<Record<string, unknown>> {
  if (step.method === 'DELETE' && !isRollback) {
    throw new Error(
      `DELETE operations are blocked for safety. Step: ${step.purpose}`,
    );
  }

  for (let attempt = 0; attempt < MAX_STEP_RETRIES; attempt++) {
    try {
      return await executeOnce(step, accessToken);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const canRetry = attempt < MAX_STEP_RETRIES - 1;

      // 429 Throttled → wait and retry
      if (msg.includes('429') && canRetry) {
        const delay = 3000 * (attempt + 1);
        logger.warn(
          `Throttled (429), waiting ${delay}ms before retry ${attempt + 1}`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // 5xx Server error → wait and retry
      if (/50[0-9]/.test(msg) && canRetry) {
        logger.warn(`Server error, retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // API not enabled → auto-enable and retry
      if (
        (msg.includes('has not been used') ||
          msg.includes('is not enabled') ||
          msg.includes('SERVICE_DISABLED')) &&
        canRetry
      ) {
        const apiMatch = msg.match(/([\w.-]+\.googleapis\.com)/);
        if (apiMatch) {
          await enableGcpApi(accessToken, step.url, apiMatch[1]);
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

async function executeOnce(
  step: GcpApiStep,
  accessToken: string,
): Promise<Record<string, unknown>> {
  let url = step.url;

  // Auto-upgrade CRM v1 IAM policy URLs to v3 (v1 silently drops auditConfigs)
  if (
    url.includes('cloudresourcemanager.googleapis.com/v1/projects/') &&
    (url.includes(':getIamPolicy') || url.includes(':setIamPolicy'))
  ) {
    url = url.replace(
      'cloudresourcemanager.googleapis.com/v1/projects/',
      'cloudresourcemanager.googleapis.com/v3/projects/',
    );
  }

  if (step.queryParams && Object.keys(step.queryParams).length > 0) {
    const qs = new URLSearchParams(step.queryParams);
    url += (url.includes('?') ? '&' : '?') + qs.toString();
  }

  // Auto-inject requestedPolicyVersion: 3 for getIamPolicy calls
  // Without this, GCP returns v1 policies that omit auditConfigs and conditions
  let effectiveBody = step.body;
  if (
    step.method === 'POST' &&
    step.url.includes(':getIamPolicy') &&
    (!step.body || !step.body.options)
  ) {
    effectiveBody = {
      ...step.body,
      options: { requestedPolicyVersion: 3 },
    };
  }

  logger.log(`${step.method} ${url} — ${step.purpose}`);
  if (
    effectiveBody &&
    (step.method === 'POST' || step.method === 'PUT' || step.method === 'PATCH')
  ) {
    const bodyStr = JSON.stringify(effectiveBody);
    logger.debug(
      `  Body (${bodyStr.length} chars): ${bodyStr.substring(0, 2000)}${bodyStr.length > 2000 ? '...' : ''}`,
    );
  }

  const response = await fetch(url, {
    method: step.method,
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

  // 409 = already exists → treat as success (idempotent)
  if (response.status === 409 || errorStatus === 'ALREADY_EXISTS') {
    logger.log(`Already exists (success): ${step.purpose}`);
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
): Promise<void> {
  // Extract project ID from the step URL
  const projectMatch = stepUrl.match(/\/projects\/([^/?#]+)/);
  if (!projectMatch) {
    logger.warn(`Cannot extract project ID from URL to enable API: ${apiName}`);
    return;
  }
  const projectId = projectMatch[1];
  if (!SAFE_GCP_PROJECT_PATTERN.test(projectId)) {
    logger.warn(
      `Refusing to auto-enable API for unexpected project segment: ${apiName}`,
    );
    return;
  }

  logger.log(`Auto-enabling GCP API: ${apiName} in project ${projectId}`);
  try {
    const resp = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${apiName}:enable`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (resp.ok || resp.status === 409) {
      logger.log(`API ${apiName} enabled — waiting 10s for propagation`);
      await new Promise((r) => setTimeout(r, 10_000));
    } else {
      logger.warn(`Failed to enable ${apiName}: ${resp.status}`);
    }
  } catch (err) {
    logger.warn(
      `API enablement error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Long-Running Operation Polling ────────────────────────────────────────

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
    logger.warn('Operation has no selfLink — returning without polling');
    return operation;
  }

  // Validate selfLink URL to prevent SSRF via response data
  try {
    const parsed = new URL(selfLink);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'googleapis.com' && !host.endsWith('.googleapis.com')) {
      logger.warn(`Operation selfLink targets disallowed host: ${host}`);
      return operation;
    }
  } catch {
    logger.warn('Operation selfLink is malformed');
    return operation;
  }

  const startTime = Date.now();
  let pollInterval = 2000;

  while (Date.now() - startTime < MAX_POLL_MS) {
    await new Promise((r) => setTimeout(r, pollInterval));
    pollInterval = Math.min(pollInterval * 1.5, 10_000);

    const resp = await fetch(selfLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      logger.warn(`Operation poll failed: ${resp.status}`);
      return operation;
    }

    const updated = (await resp.json()) as Record<string, unknown>;
    if (updated.status === 'DONE') {
      if (updated.error) {
        const errors = (updated.error as Record<string, unknown>).errors as
          Array<{ message: string }> | undefined;
        if (errors?.length) {
          throw new Error(`GCP operation failed: ${errors[0].message}`);
        }
      }
      return updated;
    }
  }

  logger.warn(`Operation timed out after ${MAX_POLL_MS}ms`);
  return operation;
}

// ─── Validation ────────────────────────────────────────────────────────────

export function validateGcpPlanSteps(
  steps: GcpApiStep[],
  opts?: {
    assetClass?: GcpRemediationAssetClass;
    enforceAllowlist?: boolean;
    isRollback?: boolean;
  },
): string[] {
  const errors: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.url) {
      errors.push(`Step ${i + 1}: URL is required`);
      continue;
    }
    if (!step.method) errors.push(`Step ${i + 1}: method is required`);
    // POST/PUT/PATCH to mutation endpoints must have a body
    if (
      (step.method === 'POST' ||
        step.method === 'PUT' ||
        step.method === 'PATCH') &&
      !step.url.includes(':getIamPolicy') &&
      !step.url.includes('/stop') &&
      !step.url.includes('/start') &&
      (!step.body || Object.keys(step.body).length === 0)
    ) {
      errors.push(
        `Step ${i + 1}: ${step.method} ${step.url.split('/').pop()} requires a request body but none was provided`,
      );
    }
    try {
      const parsed = new URL(step.url);
      if (parsed.protocol !== 'https:') {
        errors.push(`Step ${i + 1}: URL must use HTTPS`);
      }
      const host = parsed.hostname.toLowerCase();
      if (host !== 'googleapis.com' && !host.endsWith('.googleapis.com')) {
        errors.push(`Step ${i + 1}: URL must be a Google API endpoint`);
      }
    } catch {
      errors.push(`Step ${i + 1}: URL must be a valid absolute URL`);
    }
    // Fix-forward allowlist: write steps must be covered by the finding's
    // asset-class list. Reads (GET) and unscoped calls skip this — pass
    // enforceAllowlist only for fix/rollback validation.
    if (opts?.enforceAllowlist && opts.assetClass && step.method !== 'GET') {
      // Rollback DELETEs stay prefix-scoped: the method exemption below only
      // applies to URLs under the class's own API prefixes, so an
      // AI-generated rollback cannot DELETE an arbitrary Google API.
      const allowlisted =
        opts.isRollback && step.method === 'DELETE'
          ? gcpRollbackDeletePrefixAllowed({
              assetClass: opts.assetClass,
              url: step.url,
            })
          : isGcpAllowlistedFixStep({
              assetClass: opts.assetClass,
              method: step.method,
              url: step.url,
            });
      if (!allowlisted) {
        errors.push(
          `Step ${i + 1}: ${step.method} ${step.url} is not allowlisted for ${opts.assetClass} fixes`,
        );
      }
    }
    // Never-allow permissions must not appear in any step body.
    if (step.body) {
      const bodyText = JSON.stringify(step.body);
      for (const denied of GCP_NEVER_ALLOW_PERMISSIONS) {
        if (bodyText.includes(denied)) {
          errors.push(
            `Step ${i + 1}: permission ${denied} is never allowed in fixes`,
          );
          break;
        }
      }
    }
  }
  return errors;
}
