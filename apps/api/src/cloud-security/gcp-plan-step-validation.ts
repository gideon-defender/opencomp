/**
 * Plan-step validation for GCP remediation.
 *
 * Extracted from `gcp-command-executor.ts` to respect the 300-line repo
 * limit: the executor executes, this module validates. Every `string[]`
 * below is a refusal list — empty means the steps may run. Pure function,
 * no NestJS, no network.
 */
import {
  GCP_NEVER_ALLOW_PERMISSIONS,
  gcpRollbackDeletePrefixAllowed,
  isGcpAllowlistedFixStep,
  type GcpRemediationAssetClass,
} from '@gideon-defender/integration-platform';
import { isGcpReadAllowedUrl, isGcpReadOnlyMethod } from './gcp-read-allowlist';
import {
  buildEffectiveGcpStepUrl,
  isGetIamPolicyUrl,
  validateGcpStepProject,
  decodeGcpPathToFixedPoint,
  type GcpStepQueryParams,
} from './gcp-remediation-validator-shared';
import { redactGcpUrlForLog } from './gcp-remediation-plan.utils';

export interface GcpApiStep {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
  queryParams?: GcpStepQueryParams;
  purpose: string;
}

/**
 * Never-allow permissions reachable purely by method+URL. The body/query
 * scan below cannot see these: a DELETE carries no body, and the
 * permission name appears in no query string. Each rule names the denied
 * permission from `GCP_NEVER_ALLOW_PERMISSIONS` plus the host and decoded
 * path shape that invokes it. Fix steps only — rollback DELETEs stay
 * constrained by prefix scoping, overlap, and prior-state comparison
 * instead of this scan.
 */
const NEVER_ALLOW_DELETE_RULES: ReadonlyArray<{
  permission: string;
  hostname: string;
  pathIncludes: string;
  pathExcludes?: string;
}> = [
  {
    permission: 'compute.instances.delete',
    hostname: 'compute.googleapis.com',
    pathIncludes: '/instances/',
  },
  {
    permission: 'compute.firewalls.delete',
    hostname: 'compute.googleapis.com',
    pathIncludes: '/firewalls/',
  },
  {
    permission: 'compute.disks.delete',
    hostname: 'compute.googleapis.com',
    pathIncludes: '/disks/',
  },
  {
    // Object deletes (`/b/<bucket>/o/...`) are not bucket deletes.
    permission: 'storage.buckets.delete',
    hostname: 'storage.googleapis.com',
    pathIncludes: '/storage/v1/b/',
    pathExcludes: '/o/',
  },
  {
    permission: 'sql.instances.delete',
    hostname: 'sqladmin.googleapis.com',
    pathIncludes: '/instances/',
  },
  {
    permission: 'bigquery.datasets.delete',
    hostname: 'bigquery.googleapis.com',
    pathIncludes: '/datasets/',
  },
  {
    permission: 'resourcemanager.projects.delete',
    hostname: 'cloudresourcemanager.googleapis.com',
    pathIncludes: '/projects/',
  },
];

export function validateGcpPlanSteps(
  steps: GcpApiStep[],
  opts?: {
    assetClass?: GcpRemediationAssetClass;
    enforceAllowlist?: boolean;
    isRollback?: boolean;
    /**
     * Read validation: steps must be read-only (GET, or POST for
     * `:getIamPolicy`) and target a read-allowed host. The auditor token
     * runs reads before any acknowledgment, so a write smuggled into
     * `readSteps` would execute outside the allowlist and parameter gates.
     */
    isRead?: boolean;
    /**
     * Project the finding under remediation belongs to. Steps that name a
     * different project are refused — a plan for one project must never
     * read or write another, or prior-state binds to the wrong resource.
     * Steps that name a project or bucket the finding cannot bind fail
     * closed (see `validateGcpStepProject`).
     */
    expectedProjectId?: string;
    /**
     * Bucket the finding belongs to. Storage steps must name this bucket
     * (see `validateGcpStepProject`) — absent means the finding names no
     * bucket and Storage steps refuse.
     */
    expectedBucket?: string;
  },
): string[] {
  const errors: string[] = [];
  // Enforcement without a class cannot verdict anything: the old shape
  // silently skipped the allowlist block, so a caller that forgot the
  // class executed outside the allowlist. Fail closed instead.
  if (opts?.enforceAllowlist && !opts.assetClass) {
    return [
      'Allowlist enforcement requires an asset class — refused for safety',
    ];
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.url) {
      errors.push(`Step ${i + 1}: URL is required`);
      continue;
    }
    if (!step.method) {
      errors.push(`Step ${i + 1}: method is required`);
      continue;
    }
    // Validate the effective URL — raw `step.url` plus merged
    // `queryParams`, the exact string the executor fetches. Validating only
    // the raw URL would let AI-controlled query keys/values change write
    // semantics outside every gate below.
    const effectiveUrl = buildEffectiveGcpStepUrl(step);
    if (
      opts?.isRead &&
      !isGcpReadOnlyMethod({ method: step.method, url: effectiveUrl })
    ) {
      errors.push(
        `Step ${i + 1}: read steps must use GET (or POST for :getIamPolicy) — refused for safety`,
      );
      continue;
    }
    if (opts?.isRead && !isGcpReadAllowedUrl(effectiveUrl)) {
      errors.push(
        `Step ${i + 1}: read target is outside the allowed read hosts — refused for safety`,
      );
      continue;
    }
    // POST/PUT/PATCH to mutation endpoints must have a body.
    // getIamPolicy reads carry options in the body instead — match on the
    // decoded pathname so encoded actions get the same exemption.
    // Instance start/stop take no body by API design (the param guardrails
    // still refuse them as lifecycle changes — this exemption only keeps
    // the refusal message accurate). Exempt by decoded pathname suffix, not
    // by substring on the full URL: `?x=/stop` in the query string is not a
    // stop call, and matching it would skip the body message for the wrong
    // step shape.
    let effectivePathname = '';
    try {
      // Fixed-point decode (same function the guards match on): a raw
      // pathname misses `%2F`-encoded `/stop` that the decoded guard
      // treats as a lifecycle path, and vice versa.
      effectivePathname =
        decodeGcpPathToFixedPoint(
          new URL(effectiveUrl).pathname,
        )?.toLowerCase() ?? '';
    } catch {
      // Reported as an invalid URL below.
    }
    if (
      (step.method === 'POST' ||
        step.method === 'PUT' ||
        step.method === 'PATCH') &&
      !isGetIamPolicyUrl(effectiveUrl) &&
      !effectivePathname.endsWith('/stop') &&
      !effectivePathname.endsWith('/start') &&
      (!step.body || Object.keys(step.body).length === 0)
    ) {
      errors.push(
        `Step ${i + 1}: ${step.method} ${redactGcpUrlForLog(effectiveUrl).split('/').pop()} requires a request body but none was provided`,
      );
    }
    try {
      const parsed = new URL(effectiveUrl);
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
    // Project binding: a step for one project must never touch another.
    // Reads bind too — prior-state keyed off another project's resource
    // would ground the fix on, and roll back to, the wrong state. Always
    // runs: with no expected project or bucket it still refuses
    // project-scoped steps the finding cannot bind (fail closed).
    errors.push(
      ...validateGcpStepProject({
        step,
        expectedProjectId: opts?.expectedProjectId ?? '',
        ...(opts?.expectedBucket
          ? { expectedBucket: opts.expectedBucket }
          : {}),
        prefix: `Step ${i + 1}`,
      }),
    );
    // Fix-forward allowlist: write steps must be covered by the finding's
    // asset-class list. GET steps carry no allowlist entry (reads are not
    // fixes), but they run with the fix token — so they must stay within
    // the read-allowed hosts instead of reaching any Google API. Pass
    // enforceAllowlist only for fix/rollback validation.
    if (opts?.enforceAllowlist && opts.assetClass) {
      // Rollback DELETEs stay prefix-scoped: the method exemption below only
      // applies to URLs under the class's own API prefixes, so an
      // AI-generated rollback cannot DELETE an arbitrary Google API.
      const allowlisted =
        step.method === 'GET'
          ? isGcpReadAllowedUrl(effectiveUrl)
          : opts.isRollback && step.method === 'DELETE'
            ? gcpRollbackDeletePrefixAllowed({
                assetClass: opts.assetClass,
                url: effectiveUrl,
              })
            : isGcpAllowlistedFixStep({
                assetClass: opts.assetClass,
                method: step.method,
                url: effectiveUrl,
              });
      if (!allowlisted) {
        // Log the redacted URL (origin + pathname): the effective URL
        // carries AI-controlled query strings that must never reach logs.
        errors.push(
          `Step ${i + 1}: ${step.method} ${redactGcpUrlForLog(effectiveUrl)} is not allowlisted for ${opts.assetClass} fixes`,
        );
      }
    }
    // Never-allow permissions must not appear in any step body or in the
    // effective query string — a denied permission smuggled via
    // `queryParams` executes on the wire exactly like one in the body.
    // Privileged-role grants (`roles/owner`, `roles/editor`) are refused
    // by the parameter guardrails per shape (removal-only on IAM/bucket,
    // backstop on generic paths) — a body substring check here would also
    // block legitimate removals that preserve an existing grant.
    {
      const scanned: string[] = [];
      if (step.body) scanned.push(JSON.stringify(step.body));
      try {
        const query = new URL(effectiveUrl).search;
        if (query) {
          scanned.push(query);
          // Match the decoded query too: WHATWG keeps percent-encoding in
          // `search`, so `iam%2Eadmin` in the URL would dodge the substring
          // match above but decode server-side to the denied permission.
          // One decode mirrors the single server-side decode — a stray `%`
          // throws, and the raw string stays scanned.
          try {
            const decoded = decodeURIComponent(query);
            if (decoded !== query) scanned.push(decoded);
          } catch {
            // Undecodable query — the raw string above still scans.
          }
        }
      } catch {
        // Unparseable URLs are already reported above.
      }
      for (const text of scanned) {
        for (const denied of GCP_NEVER_ALLOW_PERMISSIONS) {
          if (text.includes(denied)) {
            errors.push(
              `Step ${i + 1}: permission ${denied} is never allowed in fixes`,
            );
            break;
          }
        }
      }
      // Deletions ride method+URL, never bodies — a bodiless DELETE with a
      // clean query sails past the scan above while invoking a never-allow
      // permission. Match the decoded pathname (the string the server
      // routes) against the known deletion shapes.
      if (!opts?.isRollback && step.method === 'DELETE') {
        try {
          const parsed = new URL(effectiveUrl);
          const decodedPath =
            decodeGcpPathToFixedPoint(parsed.pathname)?.toLowerCase() ?? '';
          for (const rule of NEVER_ALLOW_DELETE_RULES) {
            if (
              parsed.hostname.toLowerCase() === rule.hostname &&
              decodedPath.includes(rule.pathIncludes) &&
              (!rule.pathExcludes || !decodedPath.includes(rule.pathExcludes))
            ) {
              errors.push(
                `Step ${i + 1}: permission ${rule.permission} is never allowed in fixes`,
              );
              break;
            }
          }
        } catch {
          // Unparseable URLs are already reported above.
        }
      }
    }
  }
  return errors;
}
