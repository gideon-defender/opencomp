import { asRecord, isOpenSource } from './azure-remediation-nsg-guardrails';

/** Refuse storage PATCH values that undo the fix the plan claims:
 * public blob access, HTTP downgrade, weak TLS, data-plane opens. */
export function validateStoragePatch(
  props: Record<string, unknown>,
  label: string,
): string[] {
  const findings: string[] = [];
  if (props.allowBlobPublicAccess === true) {
    findings.push(
      `${label}: "allowBlobPublicAccess": true widens access, refused for safety`,
    );
  }
  if (props.supportsHttpsTrafficOnly === false) {
    findings.push(
      `${label}: "supportsHttpsTrafficOnly": false downgrades transport, refused for safety`,
    );
  }
  if (
    typeof props.minimumTlsVersion === 'string' &&
    ['tls10', 'tls11'].includes(
      props.minimumTlsVersion.toLowerCase().replace(/[^a-z0-9]/g, ''),
    )
  ) {
    findings.push(
      `${label}: "minimumTlsVersion": "${props.minimumTlsVersion}" weakens encryption, refused for safety`,
    );
  }
  const networkAcls = asRecord(props.networkAcls);
  if (
    networkAcls &&
    typeof networkAcls.defaultAction === 'string' &&
    networkAcls.defaultAction.toLowerCase() === 'allow'
  ) {
    findings.push(
      `${label}: storage network ACL "defaultAction": "Allow" opens the data plane, refused for safety`,
    );
  }
  if (
    typeof props.publicNetworkAccess === 'string' &&
    props.publicNetworkAccess.toLowerCase() === 'enabled'
  ) {
    findings.push(
      `${label}: "publicNetworkAccess": "Enabled" opens the data plane, refused for safety`,
    );
  }
  if (networkAcls && Array.isArray(networkAcls.ipRules)) {
    // `defaultAction: Deny` with an open exception still opens the data
    // plane: each ipRule is a firewall allow-entry of its own.
    for (const rule of networkAcls.ipRules) {
      const entry = asRecord(rule);
      const value = entry ? entry.value : undefined;
      if (typeof value === 'string' && isOpenSource(value)) {
        findings.push(
          `${label}: storage network ACL ipRule "${value}" opens the data plane, refused for safety`,
        );
      }
    }
  }
  return findings;
}

/** Refuse blob-container writes that open anonymous access: the
 * allowlist admits any depth under `storageAccounts`, but the
 * account-level guard never sees container bodies. Only `None` keeps a
 * container private — an absent field changes nothing, so it passes. */
export function validateStorageContainerAccess(
  normalized: string,
  props: Record<string, unknown>,
  label: string,
): string[] {
  if (
    !normalized.includes('/blobservices/') ||
    !normalized.includes('/containers/')
  ) {
    return [];
  }
  const access = props.publicAccess;
  if (access === undefined) return [];
  if (typeof access === 'string' && access.toLowerCase() === 'none') return [];
  const rendered = typeof access === 'string' ? access : JSON.stringify(access);
  return [
    `${label}: container "publicAccess": "${rendered}" opens anonymous access, refused for safety`,
  ];
}
