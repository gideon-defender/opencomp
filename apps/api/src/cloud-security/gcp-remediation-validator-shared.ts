/**
 * Shared matchers for GCP remediation validators.
 *
 * Houses the URL-canonicalization, project-binding, and IAM-action
 * matchers used by both `gcp-remediation-param-guardrails` and
 * `gcp-remediation-rollback-validators` so the two modules cannot drift
 * apart. Step-URL builders live in `gcp-remediation-step-url.ts` and
 * grant-shape predicates in `gcp-remediation-grant-checks.ts`, re-exported
 * below so existing importers keep working. Prior-state lookups live in
 * `gcp-remediation-prior-state.ts` — import them from there directly.
 */

export { rangesExposeFullIpSpace } from './gcp-remediation-ip-ranges';
export {
  bindingsGrantPrivilegedRole,
  bindingsGrantPublicAccess,
  bodyGrantsPrivilegedRoleDeep,
  bodyGrantsPublicAccessDeep,
  accessForeignShareEntries,
  datasetAccessGrantsPrivilegedRole,
  datasetAccessGrantsPublicAccess,
  isForeignResourceShareEntry,
  isPublicAclEntry,
  isPublicIamMember,
  isPublicPredefinedAcl,
} from './gcp-remediation-grant-checks';
export {
  buildEffectiveGcpStepUrl,
  asRecord,
  decodeGcpPathToFixedPoint,
  isRecord,
  parsedGcpUrl,
  sameQueryIdentity,
  stepLabel,
  stepQueryIdentity,
  stepQueryParam,
  stepQueryParamValues,
  urlPathSegments,
  urlResource,
  type GcpStepInput,
  type GcpStepQueryParams,
} from './gcp-remediation-step-url';
import {
  decodeGcpPathToFixedPoint,
  stepQueryParamValues,
  urlPathSegments,
  type GcpStepQueryParams,
} from './gcp-remediation-step-url';

/**
 * Parse a GCP retention `Duration` (`3600s`, `3.5s`) to seconds.
 * Returns 0 for every zero spelling (`0s`, `0.0s`, `00s`) and undefined
 * for malformed values — an unreadable period is not an approvable one.
 */
export function retentionSeconds(period: string): number | undefined {
  const match = period.trim().match(/^(\d+)(?:\.(\d+))?s$/);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  const fraction = match[2] === undefined ? 0 : Number(`0.${match[2]}`);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(fraction)) {
    return undefined;
  }
  return seconds + fraction;
}

/** Record-shape helpers below. IP-range logic lives in
 * `gcp-remediation-ip-ranges.ts` (re-exported above). */

/**
 * Decoded pathname of an absolute URL, or `undefined` when it is not
 * parseable. Decodes to a fixed point (up to 4 rounds) because WHATWG
 * `pathname` preserves percent-encoding: `...%3AsetIamPolicy`,
 * `...%253AsetIamPolicy`, and `...:setIamPolicy` route to the same action,
 * so guards must see the same string the allowlist normalizer and the
 * executor dispatch see. A single decode lets double-encoding split the
 * IAM guard from the sink.
 */
export function decodedPathname(url: string): string | undefined {
  try {
    return decodeGcpPathToFixedPoint(new URL(url).pathname);
  } catch {
    return undefined;
  }
}

/**
 * Project named by a step URL: the `/projects/<id>/` path segment, or the
 * effective `project` query param on hosts without one (storage bucket
 * URLs carry no project in the path — creation calls pass it as
 * `?project=<id>`). Decoded first so an encoded segment cannot split the
 * binding from the sink, and dot-segments resolved so a traversal path
 * cannot bind to one project while routing to another. Returns undefined
 * when the URL carries no project signal (a bare bucket path with no
 * `project` param) — only callers for globally-namespaced hosts (Storage)
 * treat absence as unbindable; all others fail closed.
 */
export function extractGcpStepProjectId(step: {
  url: string;
  queryParams?: GcpStepQueryParams;
}): string | undefined {
  const segments = urlPathSegments(step.url);
  if (segments !== undefined) {
    const at = segments.indexOf('projects');
    if (at >= 0 && at + 1 < segments.length) {
      // RPC-style suffixes ride the id segment (`projects/p:getIamPolicy`)
      // — the project is the part before the colon. Project ids never
      // contain a colon, so cutting there cannot merge two projects.
      const raw = segments[at + 1];
      const cut = raw.indexOf(':');
      return cut < 0 ? raw : raw.slice(0, cut);
    }
  }
  return stepQueryParamValues(step, 'project').find(
    (value) => value.length > 0,
  );
}

/**
 * Bucket named by a Storage step URL: the segment after `/b/` in the
 * resolved decoded path (`/storage/v1/b/<bucket>/...`, including the
 * `/upload/storage/v1/...` shape). Decoded first so an encoded segment
 * cannot split the binding from the sink, and dot-segments resolved so a
 * traversal path cannot bind to one bucket while routing to another.
 * Returns undefined when the URL names no bucket (collection root,
 * creation call, unparseable URL).
 */
export function extractGcpStepBucket(url: string): string | undefined {
  const segments = urlPathSegments(url);
  if (segments === undefined) return undefined;
  const at = segments.indexOf('b');
  if (at < 0 || at + 1 >= segments.length) return undefined;
  return segments[at + 1];
}

/**
 * Bucket a finding belongs to, from its resource id. Storage findings
 * carry `<project>/<bucket>` — the bucket is the last segment. Returns
 * undefined when the id names no bucket (bare project, null): there is
 * nothing to bind, and the check passes like an empty expected project.
 *
 * Non-storage findings with slashed ids bind storage steps to their last
 * segment — a SQL fix has no legitimate Storage write, so its storage
 * steps fail closed rather than reaching another resource's bucket.
 */
export function extractGcpFindingBucket(args: {
  resourceId: string | null;
}): string | undefined {
  if (typeof args.resourceId !== 'string') return undefined;
  const slash = args.resourceId.lastIndexOf('/');
  if (slash < 0 || slash + 1 >= args.resourceId.length) return undefined;
  return args.resourceId.slice(slash + 1);
}

/**
 * Refuse steps that name a different project than the finding under
 * remediation — a fix for `proj-A` must never write `proj-B`, even when
 * the service account would allow it. A step that names a project the
 * finding cannot bind (empty expected project) is unverifiable and refuses
 * too: executing a project-scoped write blind is fail-open.
 *
 * A step that names a project or (on Storage) a bucket the finding
 * cannot bind fails closed: Storage bucket URLs carry no project in the
 * path (creation passes it as `?project=`), so a Storage step without a
 * bucket binding is unverifiable even when the finding names a project —
 * bucket names are global and no project signal can pin the step down.
 * Every other GCP API embeds `/projects/<id>/` in the path — a missing
 * signal there is malformed or evasive, never legitimate.
 */
export function validateGcpStepProject(args: {
  step: { url: string; queryParams?: GcpStepQueryParams };
  expectedProjectId: string;
  prefix: string;
  /**
   * Bucket the finding belongs to. Storage steps must name this bucket —
   * a fix for one bucket must never write another, even when the service
   * account would allow it. Absent means the finding names no bucket and
   * Storage steps refuse: a bare bucket path carries no project signal,
   * so a project-only finding cannot prove which bucket the step touches.
   */
  expectedBucket?: string;
}): string[] {
  const actual = extractGcpStepProjectId(args.step);
  let hostname = '';
  try {
    hostname = new URL(args.step.url).hostname.toLowerCase();
  } catch {
    return [`${args.prefix}: URL is not parseable — refused for safety`];
  }
  const isStorageHost = hostname === 'storage.googleapis.com';
  const actualBucket = isStorageHost
    ? extractGcpStepBucket(args.step.url)
    : undefined;
  // A step that names a project the finding cannot bind is unverifiable:
  // with no expected project there is nothing to compare, but executing
  // a project-scoped write blind is fail-open, so it refuses. A Storage
  // step that names a bucket the finding cannot bind is unverifiable for
  // the same reason — bucket names are global, so no project signal can
  // pin the step down. Steps with no signal at all keep today's behavior
  // (other gates refuse provisioning and malformed URLs).
  if (!args.expectedProjectId && !args.expectedBucket) {
    if (actual !== undefined) {
      return [
        `${args.prefix}: step targets project "${actual}" but the finding names no resolvable project — unverifiable cross-project write — refused for safety`,
      ];
    }
    if (actualBucket !== undefined) {
      return [
        `${args.prefix}: step targets bucket "${actualBucket}" but the finding names no bucket — unverifiable cross-bucket write — refused for safety`,
      ];
    }
    return [];
  }
  // A mismatched project signal always refuses, on every host.
  if (
    args.expectedProjectId &&
    actual !== undefined &&
    actual !== args.expectedProjectId
  ) {
    return [
      `${args.prefix}: step targets project "${actual}" but the finding belongs to project "${args.expectedProjectId}" — cross-project writes are never a fix — refused for safety`,
    ];
  }
  if (isStorageHost) {
    // Bare bucket paths carry no project signal, but they always carry a
    // bucket: bind it to the finding's bucket when known. Without a
    // bucket binding the step names a globally-unique bucket the finding
    // cannot pin down — fail closed rather than let a fix for one bucket
    // write any bucket the token can touch.
    if (!args.expectedBucket) {
      return [
        `${args.prefix}: step targets a Storage bucket but the finding names no bucket — unverifiable cross-bucket write — refused for safety`,
      ];
    }
    const stepBucket = extractGcpStepBucket(args.step.url);
    if (stepBucket === args.expectedBucket) return [];
    if (stepBucket !== undefined) {
      return [
        `${args.prefix}: step targets bucket "${stepBucket}" but the finding belongs to bucket "${args.expectedBucket}" — cross-bucket writes are never a fix — refused for safety`,
      ];
    }
    return [
      `${args.prefix}: step names no bucket but the finding belongs to bucket "${args.expectedBucket}" — refused for safety`,
    ];
  }
  // A project-scoped step with no expected project is unverifiable, even
  // when only a bucket binds the finding (bucket binding covers Storage
  // paths, not /projects/ URLs). Refuse rather than execute blind.
  if (!args.expectedProjectId) {
    if (actual !== undefined) {
      return [
        `${args.prefix}: step targets project "${actual}" but the finding names no resolvable project — unverifiable cross-project write — refused for safety`,
      ];
    }
    return [];
  }
  if (actual === undefined) {
    return [
      `${args.prefix}: step names no project but the finding belongs to project "${args.expectedProjectId}" — refused for safety`,
    ];
  }
  return [];
}

/**
 * True when a step URL targets a `:setIamPolicy` action. Matches on the
 * decoded pathname so `%3A` encoding cannot split the guard from the sink.
 * Trailing slashes are stripped first: `...:setIamPolicy/` routes to the
 * same action. Unparseable URLs fall back to a substring match — URL-format
 * validation rejects them elsewhere, but an IAM-shaped string must never
 * read as safe.
 */
export function isSetIamPolicyUrl(url: string): boolean {
  const decoded = decodedPathname(url);
  if (decoded !== undefined)
    return decoded.replace(/\/+$/, '').endsWith(':setIamPolicy');
  return url.includes(':setIamPolicy');
}

/**
 * True when a step URL targets a `:getIamPolicy` read. Same decoded-
 * pathname semantics as `isSetIamPolicyUrl`: sinks that upgrade or exempt
 * policy reads must see the same string the guards see, or `%3A`
 * encoding splits them (v1 policy without audit configs).
 */
export function isGetIamPolicyUrl(url: string): boolean {
  const decoded = decodedPathname(url);
  if (decoded !== undefined)
    return decoded.replace(/\/+$/, '').endsWith(':getIamPolicy');
  return url.includes(':getIamPolicy');
}
