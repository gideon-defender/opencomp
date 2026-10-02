/**
 * S3 `PutPublicAccessBlock` is the fix API for public buckets, but the fix
 * only ever turns the four Block flags ON. Any flag explicitly OFF keeps the
 * bucket (or its policies/ACLs) public while the plan reads like a fix.
 * Flags are read from the nested `PublicAccessBlockConfiguration` object —
 * the shape the prompt instructs and the SDK acts on. A top-level flag is
 * refused too: it is either a model mistake or an attempt to dodge the
 * nested check.
 */
export function validatePutPublicAccessBlock(
  params: Record<string, unknown>,
  prefix: string,
): string[] {
  const errors: string[] = [];
  const nested = params.PublicAccessBlockConfiguration;
  const block =
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : {};
  for (const flag of [
    'BlockPublicAcls',
    'IgnorePublicAcls',
    'BlockPublicPolicy',
    'RestrictPublicBuckets',
  ]) {
    if (params[flag] === false || block[flag] === false) {
      errors.push(
        `${prefix}: leaving "${flag}" off keeps the bucket publicly reachable — refused for safety`,
      );
    }
  }
  // `PutPublicAccessBlock` replaces the whole configuration: flags omitted
  // from the call land as `false` server-side. A plan that sets one flag
  // `true` and omits the rest reads like a fix while leaving policy/ACL
  // public access open, so anything short of all four flags explicitly on
  // (including a missing configuration object) is refused.
  if (
    errors.length === 0 &&
    !(
      block.BlockPublicAcls === true &&
      block.IgnorePublicAcls === true &&
      block.BlockPublicPolicy === true &&
      block.RestrictPublicBuckets === true
    )
  ) {
    errors.push(
      `${prefix}: "PublicAccessBlockConfiguration" must set all four Block flags on — a partial configuration leaves the bucket publicly reachable — refused for safety`,
    );
  }
  return errors;
}
