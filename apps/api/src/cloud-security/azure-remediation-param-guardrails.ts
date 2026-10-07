import { normalizeAzureUrlForAllowlist } from '@gideon-defender/integration-platform';
import { splitDecodedPathSegments } from './azure-remediation-step-url';
import {
  asRecord,
  isOpenSource,
  validateNsgRules,
} from './azure-remediation-nsg-guardrails';
import { validateDocumentDbAccount } from './azure-remediation-documentdb-guardrails';
import {
  validateStorageContainerAccess,
  validateStoragePatch,
} from './azure-remediation-storage-guardrails';
import { validateAzureSubresourceDepth } from './azure-remediation-subresource-guardrails';

export interface AzureWriteStepContext {
  index: number;
  isRollback?: boolean;
  findingScope?: {
    subscriptionId: string;
    resourceGroup?: string;
  };
}

/**
 * Dual-use parameter guardrails for Azure write steps (Azure Phase B).
 *
 * The URL allowlist proves the step touches the right resource type; these
 * guards prove the step's VALUES do not widen access: NSG rules opened to
 * the world, storage flipped public, diagnostic categories dropped,
 * firewall rules created outside the finding's scope, vault network ACLs
 * opened, executor-internal POSTs smuggled into plans. Every refusal
 * quotes the offending value. Returns refusal strings; empty means the
 * values may run. Unparseable URLs fail closed here too — the allowlist
 * refuses them next, but a direct caller must never read silence as
 * approval.
 */
export function validateAzureWriteStepParams(
  step: {
    method: string;
    url: string;
    body?: unknown;
  },
  args: AzureWriteStepContext,
): string[] {
  if (step.method === 'GET' || step.method === 'DELETE') return [];
  const normalized = normalizeAzureUrlForAllowlist(step.url);
  const label = `Step ${args.index} (${step.method} ${normalized ? normalized.replace('https://management.azure.com/', '') : step.url})`;
  if (!normalized) {
    return [
      `${label}: URL is not an Azure management-plane call, refused for safety`,
    ];
  }
  const findings: string[] = [];
  const body = asRecord(step.body) ?? {};
  const props = asRecord(body.properties) ?? {};

  // Executor-internal provider registration is never a plan step.
  if (step.method === 'POST' && normalized.endsWith('/register')) {
    findings.push(
      `${label}: provider registration is executor-internal, refused for safety`,
    );
    return findings;
  }

  // Rollback steps get the same value judgments as fix steps. Rollback
  // bodies are model-generated and never proven equal to captured
  // previous state — exempting them turns rollback into a second-write
  // primitive that plants open values past every guard below. A restore
  // that genuinely returns an open setting fails closed here and the
  // plan ships guided-only instead of auto-executing it.
  if (normalized.includes('microsoft.network/networksecuritygroups')) {
    findings.push(...validateNsgRules(props, label));
  }
  if (normalized.includes('microsoft.storage/storageaccounts')) {
    findings.push(...validateStoragePatch(props, label));
    findings.push(...validateStorageContainerAccess(normalized, props, label));
  }
  if (normalized.includes('microsoft.documentdb/databaseaccounts')) {
    findings.push(...validateDocumentDbAccount(props, label));
  }
  if (normalized.includes('microsoft.insights/diagnosticsettings')) {
    findings.push(...validateDiagnosticSettings(props, step.method, label));
  }
  if (
    normalized.includes('microsoft.network/azurefirewalls') ||
    normalized.includes('/firewallrules/')
  ) {
    findings.push(...validateFirewallScope(step.url, args.findingScope, label));
  }
  if (normalized.includes('microsoft.keyvault/vaults')) {
    findings.push(...validateVaultAcls(props, label));
  }
  // Sub-resource depth the allowlist prefix admits but no fix needs
  // (VM extensions, internet-open SQL firewall rules).
  findings.push(...validateAzureSubresourceDepth({ normalized, props, label }));
  return findings;
}

/** Refuse diagnostic-settings PUTs that drop log categories: PUT has
 * replace semantics, so a settings document without Security logs
 * silently stops them — and a document with no `logs` at all is the
 * most effective disable of all. */
function validateDiagnosticSettings(
  props: Record<string, unknown>,
  method: string,
  label: string,
): string[] {
  const findings: string[] = [];
  if (!Array.isArray(props.logs)) {
    if (method === 'PUT') {
      findings.push(
        `${label}: diagnostic settings PUT without "logs" drops every log category, refused for safety`,
      );
    }
    return findings;
  }
  if (method === 'PUT' && props.logs.length === 0) {
    findings.push(
      `${label}: diagnostic settings PUT with empty "logs" drops every log category, refused for safety`,
    );
    return findings;
  }
  // PUT replaces the whole document: a logs array with no enabled
  // Security category silently stops Security logging, exactly like an
  // explicit disable. PATCH merges, so omission stays safe there.
  if (method === 'PUT') {
    const keepsSecurity = props.logs.some((entry) => {
      const log = asRecord(entry);
      if (!log) return false;
      const category = typeof log.category === 'string' ? log.category : '';
      return (
        category.toLowerCase().includes('security') && log.enabled !== false
      );
    });
    if (!keepsSecurity) {
      findings.push(
        `${label}: diagnostic settings PUT without an enabled Security log category drops Security logs, refused for safety`,
      );
    }
  }
  for (const entry of props.logs) {
    const log = asRecord(entry);
    if (!log) continue;
    if (log.enabled === false) {
      const category =
        typeof log.category === 'string' ? log.category : 'unknown';
      findings.push(
        `${label}: diagnostic log category "${category}" disabled, refused for safety`,
      );
    }
  }
  return findings;
}

/** Refuse firewall rules outside the finding's scope: the subscription is
 * already bound globally, so this guard adds the resource-group pin when
 * the finding carries one. Unparseable URLs and group-less URLs fail
 * closed — an undecodable scope key resolves on the wire, so silence
 * would read as approval for a scope the guard never saw. Exported for
 * direct testing: the dispatcher rejects undecodable URLs before this
 * runs, so only a direct call exercises those branches. */
export function validateFirewallScope(
  rawUrl: string,
  scope: AzureWriteStepContext['findingScope'],
  label: string,
): string[] {
  if (!scope?.resourceGroup) return [];
  let stepRg: string | undefined;
  try {
    const segments = splitDecodedPathSegments(new URL(rawUrl).pathname);
    if (!segments) {
      return [`${label}: firewall rule URL is undecodable, refused for safety`];
    }
    const at = segments.findIndex(
      (segment) => segment.toLowerCase() === 'resourcegroups',
    );
    stepRg = at >= 0 ? segments[at + 1] : undefined;
  } catch {
    return [`${label}: firewall rule URL is undecodable, refused for safety`];
  }
  if (!stepRg) {
    return [
      `${label}: firewall rule carries no resource group for the finding's "${scope.resourceGroup}", refused for safety`,
    ];
  }
  if (stepRg.toLowerCase() !== scope.resourceGroup.toLowerCase()) {
    return [
      `${label}: firewall rule targets resource group "${stepRg}" outside the finding's "${scope.resourceGroup}", refused for safety`,
    ];
  }
  return [];
}

/** Refuse vault network-ACL opens: `defaultAction: Allow` plus an
 * allowlist bypass is the data-plane equivalent of an open NSG rule —
 * and so is an open `ipRules` exception under `defaultAction: Deny`. */
function validateVaultAcls(
  props: Record<string, unknown>,
  label: string,
): string[] {
  const acls = asRecord(props.networkAcls);
  if (
    acls &&
    typeof acls.defaultAction === 'string' &&
    acls.defaultAction.toLowerCase() === 'allow'
  ) {
    return [
      `${label}: vault network ACL "defaultAction": "Allow" opens the data plane, refused for safety`,
    ];
  }
  const findings: string[] = [];
  if (acls && Array.isArray(acls.ipRules)) {
    for (const rule of acls.ipRules) {
      const entry = asRecord(rule);
      const value = entry ? entry.value : undefined;
      if (typeof value === 'string' && isOpenSource(value)) {
        findings.push(
          `${label}: vault network ACL ipRule "${value}" opens the data plane, refused for safety`,
        );
      }
    }
  }
  return findings;
}
