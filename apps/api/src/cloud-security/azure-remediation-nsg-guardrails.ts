/**
 * NSG value guardrails for Azure write steps.
 *
 * Split from `azure-remediation-param-guardrails` to respect the 300-line
 * repo limit. Pure functions only — no NestJS, no database.
 *
 * `isOpenSource` is shared with the storage and vault guards: an
 * `ipRules` exception for the whole internet opens the data plane exactly
 * like an open NSG rule opens the workload.
 */

/** Source prefixes that expose a rule to the whole internet. `::/0` is the
 * IPv6 twin of `0.0.0.0/0` — without it a rule open to the whole IPv6
 * internet sails past every guard that shares `isOpenSource`. */
const OPEN_SOURCE_PREFIXES = new Set([
  '*',
  '0.0.0.0/0',
  '::/0',
  '0:0:0:0:0:0:0:0/0',
  'internet',
]);

/** Destination ports that expose every port. */
const OPEN_PORTS = new Set(['*', '0-65535', '0-65536']);

/**
 * Ports no internet-open inbound rule may touch: remote-admin and
 * database/data ports whose exposure is the finding, not the fix. A
 * public web server legitimately opens 80/443 — those stay allowed so
 * compliant plans keep running.
 */
const SENSITIVE_PORTS = new Set([
  21, 22, 23, 135, 137, 138, 139, 445, 1433, 1434, 1521, 3306, 3389, 5432, 5433,
  5985, 5986, 6379, 6380, 7001, 9042, 9200, 9300, 11211, 27017, 27018, 27019,
]);

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isOpenSource(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    OPEN_SOURCE_PREFIXES.has(value.trim().toLowerCase())
  );
}

function isOpenPort(value: unknown): value is string {
  return typeof value === 'string' && OPEN_PORTS.has(value.trim());
}

function portListIsOpen(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((entry) => isOpenPort(entry) || isOpenSource(entry))
  );
}

/** Numeric ports a destination-port value exposes: singles (`22`),
 * ranges (`22-25`), and `*`/every-range (all sensitive ports). */
function exposedPorts(value: unknown): number[] {
  // Guard while still `unknown`: calling the `value is string` predicate
  // on an already-string variable narrows the false branch to `never`.
  if (isOpenPort(value)) return [...SENSITIVE_PORTS];
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  const single = Number(trimmed);
  if (Number.isInteger(single) && single >= 0 && single <= 65535) {
    return [single];
  }
  const range = trimmed.split('-').map((part) => Number(part.trim()));
  if (
    range.length === 2 &&
    range[0] !== undefined &&
    range[1] !== undefined &&
    Number.isInteger(range[0]) &&
    Number.isInteger(range[1]) &&
    range[0] >= 0 &&
    range[1] <= 65535 &&
    range[0] <= range[1]
  ) {
    return [...SENSITIVE_PORTS].filter(
      (port) => port >= range[0] && port <= range[1],
    );
  }
  return [];
}

/** First sensitive port a destination-port value exposes, if any. */
function firstSensitivePort(values: unknown[]): number | undefined {
  for (const value of values) {
    const hit = exposedPorts(value).find((port) => SENSITIVE_PORTS.has(port));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Refuse Allow rules reachable from the internet on every port: NSG PUT
 * replaces the whole rule set, so one open rule opens the workload. Both
 * the rule-PUT shape (`properties` is the rule) and the NSG-PUT shape
 * (`properties.securityRules[]`) are checked — and each rule is read at
 * top level AND under its nested `properties`, because ARM group PUTs
 * nest per-rule fields (`{name, properties: {access, ...}}`).
 *
 * Inbound rules open to the internet on a sensitive port (SSH, RDP,
 * databases) are refused even when scoped to one port: no fix needs an
 * internet-open admin port, while public web ports (80/443) stay allowed
 * so compliant plans keep running. Outbound rules skip the sensitive-port
 * check — an open source there names local senders, not internet callers.
 */
export function validateNsgRules(
  props: Record<string, unknown>,
  label: string,
): string[] {
  const rules = Array.isArray(props.securityRules)
    ? props.securityRules
    : [props];
  const findings: string[] = [];
  for (const rule of rules) {
    const candidate = asRecord(rule);
    if (!candidate) continue;
    // A group-PUT element carries the rule fields nested; a rule-PUT
    // carries them flat. Check both views — never neither.
    const nested = asRecord(candidate.properties);
    const views =
      nested && nested !== props ? [candidate, nested] : [candidate];
    for (const view of views) {
      const access =
        typeof view.access === 'string' ? view.access.toLowerCase() : '';
      if (access !== 'allow') continue;
      const sourceOpen =
        isOpenSource(view.sourceAddressPrefix) ||
        (Array.isArray(view.sourceAddressPrefixes) &&
          view.sourceAddressPrefixes.some(isOpenSource));
      if (!sourceOpen) continue;
      const portsOpen =
        isOpenPort(view.destinationPortRange) ||
        portListIsOpen(view.destinationPortRanges);
      const source = Array.isArray(view.sourceAddressPrefixes)
        ? view.sourceAddressPrefixes.find(isOpenSource)
        : view.sourceAddressPrefix;
      if (portsOpen) {
        findings.push(
          `${label}: NSG Allow rule open to "${String(source)}" on every port, refused for safety`,
        );
        continue;
      }
      // A missing direction reads as inbound: ARM requires the field, so
      // an absent one is attacker-shaped, not outbound.
      const direction =
        typeof view.direction === 'string'
          ? view.direction.toLowerCase()
          : 'inbound';
      if (direction !== 'inbound') continue;
      const portValues = [
        view.destinationPortRange,
        ...(Array.isArray(view.destinationPortRanges)
          ? view.destinationPortRanges
          : []),
      ];
      const sensitive = firstSensitivePort(portValues);
      if (sensitive !== undefined) {
        findings.push(
          `${label}: NSG Allow rule open to "${String(source)}" on sensitive port ${sensitive}, refused for safety`,
        );
      }
    }
  }
  return findings;
}
