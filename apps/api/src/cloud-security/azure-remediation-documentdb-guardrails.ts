import { asRecord, isOpenSource } from './azure-remediation-nsg-guardrails';

/** Refuse Cosmos DB account values that widen access: `publicNetworkAccess:
 * Enabled` undoes the fix unless the same body restricts callers with
 * non-open `ipRules` or a VNet filter — and an open `ipAddressOrRange`
 * exception opens the data plane under any `defaultAction`. Cosmos
 * `ipRules` carry `ipAddressOrRange`, not storage's `value`, so the
 * storage loop would never match them. */
export function validateDocumentDbAccount(
  props: Record<string, unknown>,
  label: string,
): string[] {
  const findings: string[] = [];
  if (
    typeof props.publicNetworkAccess === 'string' &&
    props.publicNetworkAccess.toLowerCase() === 'enabled' &&
    !documentDbHasCallerRestriction(props)
  ) {
    findings.push(
      `${label}: "publicNetworkAccess": "Enabled" without IP or VNet restriction opens the data plane, refused for safety`,
    );
  }
  if (Array.isArray(props.ipRules)) {
    for (const rule of props.ipRules) {
      const entry = asRecord(rule);
      const range = entry ? entry.ipAddressOrRange : undefined;
      if (typeof range === 'string' && isOpenSource(range)) {
        findings.push(
          `${label}: Cosmos DB ipRule "${range}" opens the data plane, refused for safety`,
        );
      }
    }
  }
  return findings;
}

/** True when a Cosmos DB body restricts callers without opening to the
 * world: a VNet filter, or at least one scoped (non-open) ipRule. */
function documentDbHasCallerRestriction(
  props: Record<string, unknown>,
): boolean {
  if (props.isVirtualNetworkFilterEnabled === true) return true;
  if (!Array.isArray(props.ipRules)) return false;
  return props.ipRules.some((rule) => {
    const entry = asRecord(rule);
    const range = entry ? entry.ipAddressOrRange : undefined;
    return (
      typeof range === 'string' && range.trim() !== '' && !isOpenSource(range)
    );
  });
}
