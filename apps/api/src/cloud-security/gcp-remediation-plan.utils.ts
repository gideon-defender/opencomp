/**
 * Plan-level helpers for the GCP remediation service.
 *
 * Split from `gcp-remediation.service.ts` to respect the 300-line repo
 * limit. Pure functions only — no NestJS, no database.
 */
import {
  assertRemediationPlanHash,
  hashRemediationPlanSteps,
  type HashablePlanStep,
} from './remediation-plan-hash';
import type { PlanHashBinding } from './remediation-stable-json';
import type {
  GcpStepInput,
  GcpStepQueryParams,
} from './gcp-remediation-step-url';

/**
 * Extract the GCP project id for a finding: evidence `projectId` first,
 * then `projects/<id>` in the resource id, then display name as fallback.
 */
export function extractGcpFindingProjectId(args: {
  evidence: Record<string, unknown>;
  resourceId: string | null;
}): string {
  const fromEvidence =
    typeof args.evidence.projectId === 'string'
      ? args.evidence.projectId.trim()
      : '';
  if (fromEvidence) return fromEvidence;
  const match =
    typeof args.resourceId === 'string'
      ? args.resourceId.match(/projects\/([^/]+)/)
      : null;
  if (match?.[1]) return match[1];
  const display =
    typeof args.evidence.projectDisplayName === 'string'
      ? args.evidence.projectDisplayName.trim()
      : '';
  return display;
}

/**
 * Stable hash of a GCP plan for the acknowledgment binding. Thin wrapper
 * over the shared core — the hash bytes are unchanged.
 */
export function hashGcpPlanSteps(
  steps: HashablePlanStep[],
  rollbackSteps: HashablePlanStep[] = [],
  binding: PlanHashBinding,
): string {
  return hashRemediationPlanSteps({
    provider: 'gcp',
    fixSteps: steps,
    rollbackSteps,
    binding,
  });
}

/**
 * Refuse when the acknowledged preview hash no longer matches the steps
 * about to run. Thin wrapper over the shared core.
 */
export function assertAcknowledgedPlanHash(args: {
  expectedPlanHash: string | undefined;
  binding: PlanHashBinding;
  fixSteps: HashablePlanStep[];
  rollbackSteps?: HashablePlanStep[];
}): void {
  assertRemediationPlanHash({
    provider: 'gcp',
    expectedPlanHash: args.expectedPlanHash,
    binding: args.binding,
    fixSteps: args.fixSteps,
    ...(args.rollbackSteps ? { rollbackSteps: args.rollbackSteps } : {}),
  });
}

/**
 * Narrow an untyped JSON value (e.g. a stored Prisma Json field) to a
 * string-keyed record, or return `undefined` when it is not one.
 */
export function asStringRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Narrow a persisted `queryIdentity` value to `queryParams` overlap can
 * compare. Anything unexpected reads as absent — overlap then fails closed
 * instead of binding to attacker-shaped data.
 */
function toNameQueryParams(value: unknown): GcpStepQueryParams | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const names = value.filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );
  if (names.length === 0) return undefined;
  return { name: names };
}

/**
 * Reconstruct fix-step method+URL pairs from an executed action's
 * `appliedState.steps` (`"METHOD url"` command strings) so rollback
 * overlap validation can prove every rollback target was actually fixed.
 * Unparseable entries are dropped — fewer fix dirs means stricter overlap.
 * Query identity (`queryIdentity`, persisted beside each command)
 * rehydrates into `queryParams`: overlap compares `?name=` values, and the
 * redacted command string no longer carries them.
 */
export function appliedFixStepsForOverlap(
  appliedState: Record<string, unknown>,
): GcpStepInput[] {
  const steps = appliedState.steps;
  if (!Array.isArray(steps)) return [];
  const out: GcpStepInput[] = [];
  for (const entry of steps) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.command !== 'string') continue;
    const space = record.command.indexOf(' ');
    if (space <= 0) continue;
    const method = record.command.slice(0, space);
    const url = record.command.slice(space + 1);
    if (!method || !url) continue;
    const queryParams = toNameQueryParams(record.queryIdentity);
    out.push({
      method,
      url,
      purpose: typeof record.purpose === 'string' ? record.purpose : '',
      ...(queryParams ? { queryParams } : {}),
    });
  }
  return out;
}

const REDACTED_KEYS = new Set([
  'bindings',
  'members',
  'access',
  'acl',
  'defaultObjectAcl',
  'etag',
  // Identity material: member emails and grant targets are PII, not debug data.
  'email',
  'specialGroup',
  'entity',
]);

/**
 * Secret-name fragments: AI-generated bodies invent compound key names
 * (`dbPassword`, `admin_password`) faster than an exact-match list can
 * enumerate them, so any key containing one of these fragments redacts.
 * Structural keys above stay exact — `access` as a fragment would swallow
 * harmless keys like `accessible`.
 */
const SECRET_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'privatekey',
  'credential',
  'authorization',
];

function isRedactedKey(key: string): boolean {
  if (REDACTED_KEYS.has(key)) return true;
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = isRedactedKey(key)
        ? '[redacted]'
        : redactValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Body shape safe for debug logs: IAM members, ACLs, etags, secrets, and
 * identity material become `[redacted]`. Callers log the redacted shape,
 * never the raw body.
 */
export function redactGcpBodyForLog(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body) return body;
  return redactValue(body, 0) as Record<string, unknown>;
}

/**
 * Step URL safe for logs: origin + pathname only. Query strings and
 * fragments can carry credentials (`?key=`, `?access_token=`, `#...`)
 * that must never reach log storage — the pathname still identifies the
 * step for debugging. Unparseable input keeps its pre-query part only:
 * passing it through raw would log the very secrets this strips.
 */
export function redactGcpUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? '[unparseable-url]';
  }
}

/**
 * AI-controlled step purpose safe for logs: single line, bounded length.
 * Purposes arrive from the model and reach log storage verbatim — raw
 * newlines forge log lines and long text bloats storage.
 */
export function sanitizeGcpPurposeForLog(purpose: unknown): string {
  if (typeof purpose !== 'string') return '[no-purpose]';
  return purpose
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300);
}
