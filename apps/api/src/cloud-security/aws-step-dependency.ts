/**
 * Step-dependency helpers for the AWS command executor.
 *
 * Split out of `./aws-command-executor` to respect the 300-line file
 * limit. Pure functions over step params and error text — no SDK imports.
 */
/**
 * Message-only detector for missing-dependency failures — the step names a
 * resource or output that is not there (`NoSuchBucket`, `... does not
 * exist`). Used ONLY by the post-no-op skip in `executePlanSteps`: when a
 * prior same-service step was a no-op, a later step can fail because it
 * depends on output the no-op never returned (e.g. a version number).
 *
 * Deliberately narrower than `looksLikeValidationError`: malformed-step
 * errors (`is required`, `invalid parameter`, ...) mean the AI generated a
 * broken step, and skipping those would report progress while leaving the
 * resource un-remediated. Those stay fatal.
 */
export function looksLikeMissingDependencyError(message: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('notfound') ||
    lower.includes('does not exist') ||
    lower.includes('doesnotexist') ||
    lower.includes('no such') ||
    lower.includes('nosuch') ||
    lower.includes('could not be found') ||
    lower.includes('cannot be found') ||
    lower.includes('not exist')
  );
}

/**
 * Param keys that name a resource identifier (`Bucket`, `LogGroupName`,
 * `TrailName`, `TopicArn`, ...). Values under any other key (status flags,
 * version numbers, configuration blobs) are NOT identifiers — two steps can
 * share `Enabled` while touching different resources.
 */
const IDENTIFIER_PARAM_KEY =
  /(name|bucket|arn|resource|ids?|key|table|topic|queue|function|role|policy|group|trail|document|filter|alarm|rule|export|secret|path|prefix|target|source|dest)$/i;

/**
 * Collect identifier-shaped string values from step params: strings under an
 * identifier key, recursing into nested objects and arrays. Numbers,
 * booleans, and short/blank strings never count — a shared port number or
 * status flag is not proof two steps touch the same resource.
 */
export function collectIdentifierStrings(
  value: unknown,
  into: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIdentifierStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (IDENTIFIER_PARAM_KEY.test(key)) {
        collectDirectStrings(item, into);
      } else {
        collectIdentifierStrings(item, into);
      }
    }
  }
  // Bare strings carry no key, so they prove nothing — a shared status flag
  // like `Enabled` is not a shared resource. Only keyed values count.
}

function collectDirectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length >= 3) into.add(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDirectStrings(item, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectDirectStrings(item, into);
  }
}

/**
 * True when the failing step names at least one identifier the prior step
 * used. A same-service typo (right service, wrong resource name) shares
 * nothing with the no-op and must stay fatal instead of reporting skipped
 * progress.
 */
export function sharesResourceIdentifier(
  priorParams: unknown,
  failingParams: unknown,
): boolean {
  const prior = new Set<string>();
  collectIdentifierStrings(priorParams, prior);
  if (prior.size === 0) return false;
  const failing = new Set<string>();
  collectIdentifierStrings(failingParams, failing);
  for (const candidate of failing) {
    if (prior.has(candidate)) return true;
  }
  return false;
}
