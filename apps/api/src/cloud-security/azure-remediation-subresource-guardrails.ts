/**
 * Dangerous sub-resource depth guardrails for Azure write steps.
 *
 * Pure functions only — no NestJS, no database.
 *
 * The URL allowlist matches provider prefixes with segment-boundary
 * matching, so a fix step may address ANY depth under an allowlisted
 * resource type — not just the resource itself. These guards refuse the
 * depths whose values hand the caller power beyond the finding: VM
 * extensions (a CustomScript extension runs attacker commands as SYSTEM
 * on the machine) and SQL-family firewall rules opened to the internet
 * (the data-plane equivalent of an open NSG rule).
 */
export function validateAzureSubresourceDepth(args: {
  normalized: string;
  props: Record<string, unknown>;
  label: string;
}): string[] {
  const findings: string[] = [];
  if (
    args.normalized.includes('microsoft.compute/') ||
    args.normalized.includes('microsoft.containerservice/') ||
    args.normalized.includes('microsoft.containerregistry/')
  ) {
    findings.push(...validateComputeDepth(args.normalized, args.label));
  }
  if (
    args.normalized.includes('microsoft.sql/') ||
    args.normalized.includes('microsoft.dbfor')
  ) {
    findings.push(...validateSqlFirewallRange(args.props, args.label));
  }
  return findings;
}

/** Resource types whose children may include an `extensions` collection. */
const COMPUTE_EXTENSION_PARENTS = new Set([
  'virtualmachines',
  'managedclusters',
  'registries',
]);

/** Refuse extension writes under compute resources: extensions install
 * and run code on the machine, which no remediation fix needs. */
function validateComputeDepth(normalized: string, label: string): string[] {
  const segments = normalized
    .toLowerCase()
    .split('/')
    .filter((segment) => segment !== '');
  // Segment comparison, not substring: the normalizer strips trailing
  // slashes, so a bare `.../vm/extensions` collection path contains no
  // `/extensions/` substring and would evade a substring check. An
  // `extensions` segment is an extension child only when it sits below a
  // named resource (`.../virtualMachines/vm/extensions`) — never when it
  // is the resource name itself (a VM literally named "extensions").
  let lastParentIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (COMPUTE_EXTENSION_PARENTS.has(segments[i])) {
      lastParentIndex = i;
    }
    if (segments[i] === 'extensions' && i - lastParentIndex > 1) {
      return [
        `${label}: .../extensions/ writes run code on the machine, refused for safety`,
      ];
    }
  }
  return [];
}

/** Refuse SQL-family firewall rules opened to the internet: an
 * `allow-all` range undoes network isolation for the database. */
function validateSqlFirewallRange(
  props: Record<string, unknown>,
  label: string,
): string[] {
  if (!rangeIsInternetOpen(props.startIpAddress, props.endIpAddress)) {
    return [];
  }
  return [
    `${label}: firewall rule open to "${String(props.startIpAddress)}-${String(props.endIpAddress)}", refused for safety`,
  ];
}

/** Widest range a remediation fix may open: a /16 (65,536 addresses).
 * No fix needs more — anything wider hands the database to a swath of
 * the internet, so it reads as internet-open even when it dodges both
 * exact edges (`0.0.0.1–255.255.255.254` admits all but a sliver). */
const MAX_FIREWALL_RANGE_WIDTH = 0xffff;

/** True for ranges that expose the database to the internet: the exact
 * Azure "allow all" pair, wildcard spellings, anything anchored at an
 * internet edge (`0.0.0.0–…` or `…–255.255.255.255`, which admits all but
 * a sliver of the address space), anything wider than a /16 (same
 * exposure without touching an edge), and anything unparseable or
 * inverted (fail closed — a firewall write the guard cannot read must
 * not run).
 * A scoped range such as `10.0.0.1–10.0.0.1` is not an internet open.
 * Non-string inputs mean the step expresses no range (e.g. a database
 * SKU write under `Microsoft.Sql/`), so they pass — this guard only
 * judges ranges that are actually present. */
function rangeIsInternetOpen(start: unknown, end: unknown): boolean {
  if (typeof start !== 'string' || typeof end !== 'string') return false;
  const s = start.trim().toLowerCase();
  const e = end.trim().toLowerCase();
  if (s === '*' || e === '*') return true;
  const startNum = parseIpv4(s);
  const endNum = parseIpv4(e);
  if (startNum === null || endNum === null) return true;
  if (startNum > endNum) return true;
  return (
    startNum === 0 ||
    endNum === 0xffffffff ||
    endNum - startNum > MAX_FIREWALL_RANGE_WIDTH
  );
}

/** Parse a dotted-quad IPv4 address to its uint32 value, or null when
 * the input is not a valid IPv4 address. Rejects leading zeros
 * (`01.02.03.04`) so octal-looking input cannot slip past the edge
 * comparison above. */
function parseIpv4(value: string): number | null {
  const octets = value.split('.');
  if (octets.length !== 4) return null;
  let result = 0;
  for (const octet of octets) {
    if (!/^(0|[1-9]\d{0,2})$/.test(octet)) return null;
    const num = Number(octet);
    if (num > 255) return null;
    result = result * 256 + num;
  }
  return result;
}
