/**
 * Step-URL foundation for GCP remediation validators.
 *
 * Houses the URL builders, matchers, and rollback-shape checks every guard
 * must agree on: the effective URL (raw URL plus merged `queryParams` —
 * the exact string the executor fetches), fixed-point pathname decoding so
 * `%3A`/`%253A` encodings cannot split one guard from another, and
 * resource overlap. No imports from sibling validator modules — this file
 * is a leaf (the platform import below is the shared lower layer, not a
 * sibling).
 */
import {
  decodeGcpPathnameToFixedPoint,
  splitGcpPathSegments,
} from '@gideon-defender/integration-platform';

/**
 * Canonical query-param input: AI JSON arrives untyped at runtime, so a
 * `Record<string, string>` annotation never guarantees string values.
 * Validators must see what the executor sends — see below.
 */
export type GcpStepQueryParams = Record<string, unknown>;

/** Narrow `unknown` to a string-keyed record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Narrow `unknown` to a string-keyed record, or return null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/**
 * Decode a URL pathname to a fixed point (up to 4 rounds). Delegates to
 * the canonical platform implementation so every pathname matcher in this
 * module and the allowlist normalizer decode through one function —
 * guards cannot disagree on what a path means. Returns `undefined` when
 * the path is not decodable; callers fail closed.
 */
export function decodeGcpPathToFixedPoint(
  pathname: string,
): string | undefined {
  return decodeGcpPathnameToFixedPoint(pathname);
}

/**
 * Minimal shape of a fix/rollback step for validation and replay checks.
 * The single step type for every validator — one interface, not one per
 * flow. (The AI-boundary twin is `GcpApiStep` in `gcp-ai-remediation.prompt`,
 * inferred from the zod schema with `Record<string, string>` query params;
 * validators widen those to `Record<string, unknown>` here because AI JSON
 * arrives untyped at runtime.)
 */
export interface GcpStepInput {
  method: string;
  url: string;
  body?: Record<string, unknown>;
  queryParams?: GcpStepQueryParams;
  purpose: string;
}

/**
 * The exact URL the executor fetches for a step: the raw `step.url`
 * (preserving any `?...` already in it) plus `queryParams` appended on top.
 * Validators AND the executor must both build from this function — a
 * separately-built string lets a value execute that validation never saw.
 */
export function buildEffectiveGcpStepUrl(step: {
  url: string;
  queryParams?: GcpStepQueryParams;
}): string {
  let url = step.url;
  const params = step.queryParams;
  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const element of value) {
          if (
            typeof element === 'string' ||
            typeof element === 'number' ||
            typeof element === 'boolean'
          )
            qs.append(key, String(element));
        }
        continue;
      }
      // Only primitives serialize: objects stringify to "[object Object]"
      // and functions to source text — neither is a meaningful query value,
      // and silently coercing them lets unvalidated shapes through.
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        continue;
      const text = String(value);
      if (text) qs.append(key, text);
    }
    const encoded = qs.toString();
    if (encoded) url += (url.includes('?') ? '&' : '?') + encoded;
  }
  return url;
}

export function stepLabel(
  step: { method: string; url: string },
  index: number,
): string {
  let path = step.url.split(/[?#]/)[0];
  try {
    path = new URL(step.url).pathname;
  } catch {
    // Keep the query/fragment-stripped URL when it is not parseable; URL
    // validation reports it. Stripping first so secrets reflected into
    // `?...`/`#...` never echo into validation errors or logs.
  }
  return `Step ${index + 1} (${step.method} ${path})`;
}

/**
 * Every effective value of a step query param, read off the effective URL
 * (`buildEffectiveGcpStepUrl`) — the same string the executor fetches.
 * Reading the merged URL instead of each source separately guarantees the
 * validator sees exactly what executes, including non-string runtime
 * values that a `Record<string, string>` annotation cannot rule out.
 *
 * Callers must treat ANY returned value as effective — e.g. refuse when
 * any value is dangerous.
 */
export function stepQueryParamValues(
  step: { url: string; queryParams?: GcpStepQueryParams },
  name: string,
): string[] {
  try {
    return new URL(buildEffectiveGcpStepUrl(step)).searchParams.getAll(name);
  } catch {
    // Unparseable URLs are rejected by URL-format validation elsewhere.
    return [];
  }
}

/**
 * First effective value of a step query param, or `undefined` when absent.
 * Prefer `stepQueryParamValues` for safety checks — a single value cannot
 * prove the other source is clean.
 */
export function stepQueryParam(
  step: { url: string; queryParams?: GcpStepQueryParams },
  name: string,
): string | undefined {
  return stepQueryParamValues(step, name)[0];
}

/**
 * Identity-selecting `name` values on a step's effective URL, sorted.
 * Resource identity lives in the query string on several GCP APIs (SQL
 * users are selected by `?name=`): two steps on the same path with
 * different `name` values touch different resources, so overlap and
 * prior-state binding must compare them — `?name=alice` must never bind
 * to `?name=bob`. Operational params (`updateMask`, `alt`, `fields`)
 * are deliberately excluded: they ride the same query string but never
 * select the resource. Returns `undefined` when the URL is not parseable
 * — callers fail closed.
 */
export function stepQueryIdentity(step: {
  url: string;
  queryParams?: GcpStepQueryParams;
}): string[] | undefined {
  try {
    const names = new URL(buildEffectiveGcpStepUrl(step)).searchParams
      .getAll('name')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .sort();
    return names;
  } catch {
    return undefined;
  }
}

/**
 * True when two steps address the same query-selected identity: both
 * parse and their sorted `name` sets are equal. Steps without `name`
 * values always match — the check only constrains identity-carrying URLs.
 */
export function sameQueryIdentity(
  a: { url: string; queryParams?: GcpStepQueryParams },
  b: { url: string; queryParams?: GcpStepQueryParams },
): boolean {
  const aNames = stepQueryIdentity(a);
  const bNames = stepQueryIdentity(b);
  if (aNames === undefined || bNames === undefined) return false;
  if (aNames.length === 0 && bNames.length === 0) return true;
  return (
    aNames.length === bNames.length &&
    aNames.every((name, i) => name === bNames[i])
  );
}

/**
 * Parse a step URL into its origin-checked parts. Returns `undefined` for
 * non-absolute URLs or undecodable paths — callers fail closed (URL-format
 * validation in `validateGcpPlanSteps` already rejects such steps, but an
 * undecodable path must never read as safe).
 *
 * Matching against `hostname`/`pathname` instead of `url.includes(...)`
 * prevents substring bypasses such as
 * `https://evil.com/?x=sqladmin.googleapis.com` or
 * `https://sqladmin.googleapis.com.evil.com/`.
 */
export function parsedGcpUrl(
  url: string,
): { hostname: string; pathname: string } | undefined {
  try {
    const parsed = new URL(url);
    // Decode to a fixed point: WHATWG keeps %3A encoded, but the server
    // routes the decoded form — guards must match what executes.
    const decoded = decodeGcpPathToFixedPoint(parsed.pathname);
    if (decoded === undefined) return undefined;
    const pathname = decoded;
    // Resolve dot-segments: the allowlist normalizer and fetch both see
    // the resolved path, so dispatch must too — otherwise
    // `.../v1/../v1/b/<bucket>?predefinedAcl=publicRead` passes the
    // allowlist yet misses the storage branch and its canned-ACL guard.
    const trailingSlash = pathname.endsWith('/');
    const stack = splitGcpPathSegments(pathname);
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathname: `/${stack.join('/')}${trailingSlash ? '/' : ''}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolved path segments of a step URL: fixed-point decoded, then
 * dot-segments resolved the way the server routes them. Bindings
 * (`projects/<id>`, `b/<bucket>`) must read these — not the raw split —
 * or `.../projects/victim/../projects/attacker/...` binds to `victim`
 * while the allowlist and the fetch see `attacker`. Returns `undefined`
 * when the URL is not parseable or its path is not decodable — callers
 * fail closed.
 */
export function resolvedPathSegments(pathname: string): string[] | undefined {
  const decoded = decodeGcpPathToFixedPoint(pathname);
  if (decoded === undefined) return undefined;
  return splitGcpPathSegments(decoded);
}

export function urlPathSegments(url: string): string[] | undefined {
  try {
    return resolvedPathSegments(new URL(url).pathname);
  } catch {
    return undefined;
  }
}

/**
 * Full resource path of a step URL (origin + pathname, no trailing slash).
 * Unlike a parent directory, this keeps sibling resources distinct: two
 * buckets under `/storage/v1/b/` have different resource paths. Decoded
 * to a fixed point first so an encoded fix URL still overlaps its read —
 * see prior-state. Dot segments are resolved the way the server routes
 * them, so `.../b/good/../evil` never reads as a child of `.../b/good`.
 */
export function urlResource(url: string): string {
  try {
    const parsed = new URL(url);
    // Fixed-point decode (shared with `parsedGcpUrl`): binding must compare
    // the same string enforcement routes, or a double-encoded fix URL binds
    // to the wrong read's prior state while executing elsewhere.
    const decoded = decodeGcpPathToFixedPoint(parsed.pathname);
    const path = decoded ?? parsed.pathname;
    const normalized = `/${splitGcpPathSegments(path).join('/')}`;
    return `${parsed.origin}${normalized === '/' ? '/' : normalized}`;
  } catch {
    return url;
  }
}
