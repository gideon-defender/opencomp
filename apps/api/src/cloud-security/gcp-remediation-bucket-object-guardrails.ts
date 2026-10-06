/**
 * Storage object and ACL-endpoint guardrails for GCP bucket remediation.
 *
 * Split from `gcp-remediation-bucket-guardrails` to respect the 300-line
 * repo limit. Every rejection routes the plan to guided-only, never to
 * execution.
 */
import { resolvedPathSegments } from './gcp-remediation-step-url';

/**
 * Storage object and ACL-endpoint writes are never bucket-finding fixes.
 * Object paths (`.../b/<bucket>/o/...`) edit individual objects rather
 * than the bucket finding. ACL endpoints (`.../acl...` and
 * `.../defaultObjectAcl...`) only grant entries: a public entity or
 * OWNER-role grant is refused outright, and any other ACL-endpoint write
 * is refused as a non-fix (bucket-list narrowing on the bucket resource
 * itself stays in `validateGcpBucketPatch`). Runs after the public-grant
 * checks so pinned refusal messages keep naming the exposure.
 */
export function validateGcpStorageObjectUrl(args: {
  pathname: string;
  method: string;
  body: Record<string, unknown>;
  prefix: string;
}): string[] {
  // Match positionally: object paths are `.../b/<bucket>/o/...` and ACL
  // endpoints are `.../b/<bucket>/acl...` or
  // `.../b/<bucket>/defaultObjectAcl...`. A bare `includes` misfires on
  // buckets literally named `o` or `acl` (`PATCH .../b/acl` is a bucket
  // patch, not an ACL-endpoint write). Anchor on the FIRST `b`: it is the
  // resource separator, while object names may hold extra `/b/` segments
  // that a last-match would slice after, hiding the `/o/` marker.
  // Decode to a fixed point and resolve dot-segments before matching:
  // WHATWG keeps escapes like `%6F` encoded, but the server routes the
  // decoded form — matching raw segments lets an encoded `acl`/`o` marker
  // fall through to allow while the server still routes the ACL write.
  // Resolving too: the allowlist and the sink see `.../b/victim/../evil`
  // as `.../b/evil`, so the marker match must see it as well. Idempotent
  // on already-decoded input (dispatcher callers arrive via parsedGcpUrl).
  // Decodes through the shared canonicalizer so this matcher cannot drift
  // from the others.
  const segments = resolvedPathSegments(args.pathname.replace(/\/+$/, ''));
  if (segments === undefined) {
    return [
      `${args.prefix}: storage path is not decodable — refused for safety`,
    ];
  }
  const bIndex = segments.indexOf('b');
  const afterB = bIndex >= 0 ? segments.slice(bIndex + 1) : segments;
  if (afterB.length >= 2 && afterB[1] === 'o') {
    return [
      `${args.prefix}: object-level writes edit individual objects, not the bucket finding — refused for safety`,
    ];
  }
  if (afterB.length >= 2 && afterB[1] === 'acl') {
    return validateAclEndpointGrant({
      body: args.body,
      prefix: args.prefix,
      label: 'acl',
    });
  }
  // `defaultObjectAcl` / `defaultObjectAcl/{entity}` grants default access
  // on every future object in the bucket — the same exposure as `acl`
  // under a sibling path, so it faces the same grant checks. Without this
  // branch the endpoint fell through to `[]` and a public grant passed
  // every gate while the identical `acl` grant refused.
  if (afterB.length >= 2 && afterB[1] === 'defaultObjectAcl') {
    return validateAclEndpointGrant({
      body: args.body,
      prefix: args.prefix,
      label: 'defaultObjectAcl',
    });
  }
  // Bucket deletion is never a fix: creation is refused, so no fix can
  // create a bucket whose deletion would be a sound rollback — a DELETE
  // here destroys a pre-existing bucket. The executor permits DELETE on
  // the rollback path, so the method gate must live here.
  if (args.method === 'DELETE') {
    return [
      `${args.prefix}: deleting a bucket destroys data — never a finding fix — refused for safety`,
    ];
  }
  return [];
}

/**
 * Shared grant check for ACL-shaped endpoints (`acl`, `defaultObjectAcl`):
 * both carry `{entity, role}` grants, so both refuse public entities and
 * OWNER roles outright and refuse any other grant as a non-fix.
 */
function validateAclEndpointGrant(args: {
  body: Record<string, unknown>;
  prefix: string;
  label: string;
}): string[] {
  const entity =
    typeof args.body.entity === 'string'
      ? args.body.entity.trim().toLowerCase()
      : '';
  const role =
    typeof args.body.role === 'string'
      ? args.body.role.trim().toLowerCase()
      : '';
  if (entity === 'allusers' || entity === 'allauthenticatedusers') {
    return [
      `${args.prefix}: granting "${args.label}" to the public (allUsers) exposes the bucket — refused for safety`,
    ];
  }
  if (role === 'owner') {
    return [
      `${args.prefix}: granting "${args.label}" OWNER grants full control — refused for safety`,
    ];
  }
  return [
    `${args.prefix}: ACL-endpoint writes grant access entries — granting access is never an exposure fix — refused for safety`,
  ];
}
