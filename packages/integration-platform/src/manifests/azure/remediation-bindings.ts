import {
  AZURE_REMEDIATION_ASSET_CLASSES,
  AZURE_REMEDIATOR_SP_APP_ID_PATTERN,
  SAFE_AZURE_SUBSCRIPTION_PATTERN,
  type AzureRemediationAssetClass,
} from './remediation-roles';

/**
 * Vault binding map for Azure remediator pairs (Azure Phase A).
 *
 * The vault stores two keys per connection: `azureRemediation`
 * (`{ "Class:subscription": "<sp-app-id>" }`, mirrored to connection
 * metadata for display) and `azureRemediationSecrets`
 * (`{ "Class:subscription": "<client-secret>" }`, vault-only — never
 * metadata, never logged). Every helper here fails closed to `{}` /
 * `undefined` on bad input so callers degrade to guided-only instead of
 * throwing on stored garbage.
 */

/**
 * Maximum `Class:subscription` bindings stored on one connection. Each
 * binding costs trust probes (token + permission reads per SP) at save
 * time, so an unbounded map turns one request into unbounded outbound
 * calls.
 */
export const MAX_AZURE_REMEDIATION_PAIRS = 50;

/** Credential-map key for a pair, e.g. `Storage:12345678-…`. */
export function azureRemediationKey(params: {
  assetClass: AzureRemediationAssetClass;
  subscriptionId: string;
}): string {
  const subscriptionId = params.subscriptionId.trim();
  if (!SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    throw new Error(
      `azureRemediationKey requires a valid Azure subscription id, got "${params.subscriptionId}"`,
    );
  }
  return `${params.assetClass}:${subscriptionId}`;
}

/** True when `key` is a well-formed `AssetClass:subscription` map key. */
export function isAzureRemediationKey(key: string): boolean {
  return normalizeAzureRemediationKey(key) !== undefined;
}

/**
 * Canonical form of a pair-map key (`AssetClass:subscription`). Trims both
 * halves, so `"Storage: <sub>"` and `"Storage:<sub>"` resolve to the same
 * binding — otherwise a key that passes validation would never match the
 * canonical lookup key minted by `azureRemediationKey` and the binding
 * would silently degrade to guided-only. Returns undefined when malformed.
 */
export function normalizeAzureRemediationKey(key: string): string | undefined {
  const separator = key.indexOf(':');
  if (separator <= 0) return undefined;
  const assetClass = key.slice(0, separator).trim();
  const subscriptionId = key.slice(separator + 1).trim();
  if (!(AZURE_REMEDIATION_ASSET_CLASSES as readonly string[]).includes(assetClass)) {
    return undefined;
  }
  if (!SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscriptionId)) return undefined;
  return `${assetClass}:${subscriptionId}`;
}

/**
 * Split a canonical pair-map key into its halves. Returns undefined for
 * anything `normalizeAzureRemediationKey` would reject, so callers can
 * destructure validated keys without casting.
 */
export function parseAzureRemediationKey(key: string):
  | {
      assetClass: AzureRemediationAssetClass;
      subscriptionId: string;
    }
  | undefined {
  const canonical = normalizeAzureRemediationKey(key);
  if (!canonical) return undefined;
  const separator = canonical.indexOf(':');
  const assetClass = AZURE_REMEDIATION_ASSET_CLASSES.find(
    (candidate) => candidate === canonical.slice(0, separator),
  );
  const subscriptionId = canonical.slice(separator + 1);
  if (!assetClass || !SAFE_AZURE_SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    return undefined;
  }
  return { assetClass, subscriptionId };
}

/**
 * Parse the stored `azureRemediation` credential (a JSON string of
 * `{ "Class:subscription": "sp-app-id" }`) into a clean record. Anything
 * else yields `{}` so callers fail closed to guided-only instead of
 * throwing on bad input.
 */
export function parseAzureRemediationMap(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [rawKey, appId] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeAzureRemediationKey(rawKey);
    if (!key) continue;
    if (typeof appId !== 'string' || !appId.trim()) continue;
    const normalized = appId.trim().toLowerCase();
    if (!AZURE_REMEDIATOR_SP_APP_ID_PATTERN.test(normalized)) continue;
    out[key] = normalized;
  }
  return out;
}

/** Serialize a pair map for credential storage (drops invalid entries). */
export function serializeAzureRemediationMap(map: Record<string, string>): string {
  return JSON.stringify(parseAzureRemediationMap(map));
}

/**
 * Parse the stored `azureRemediationSecrets` credential (a JSON string of
 * `{ "Class:subscription": "<client-secret>" }`) into a clean record.
 * Secrets carry no format — any non-empty string value under a valid key
 * is kept. Anything else yields `{}`. Secrets are never mirrored to
 * connection metadata and never logged.
 */
export function parseAzureRemediationSecrets(value: unknown): Record<string, string> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [rawKey, secret] of Object.entries(parsed as Record<string, unknown>)) {
    const key = normalizeAzureRemediationKey(rawKey);
    if (!key) continue;
    if (typeof secret !== 'string' || !secret.trim()) continue;
    out[key] = secret;
  }
  return out;
}

/**
 * Fail-open-safe check for the RAW `azureRemediation` credential value.
 * Returns an error message for non-empty input that is not a JSON object
 * mapping valid keys to SP application IDs, or null when
 * absent/blank/valid.
 */
export function getAzureRemediationMapParseError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  let entries: [string, unknown][];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'azureRemediation: must be a JSON object mapping "<AssetClass>:<subscription>" to service-principal application (client) ID.';
      }
      entries = Object.entries(parsed as Record<string, unknown>);
    } catch {
      return 'azureRemediation: must be a JSON object mapping "<AssetClass>:<subscription>" to service-principal application (client) ID.';
    }
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    entries = Object.entries(value as Record<string, unknown>);
  } else {
    return 'azureRemediation: must be a JSON object mapping "<AssetClass>:<subscription>" to service-principal application (client) ID.';
  }
  if (entries.length === 0) return null;
  if (entries.length > MAX_AZURE_REMEDIATION_PAIRS) {
    return `azureRemediation: too many bindings (${entries.length}). Maximum is ${MAX_AZURE_REMEDIATION_PAIRS} — each binding costs trust probes at save time.`;
  }
  const seen = new Set<string>();
  for (const [rawKey, appId] of entries) {
    // Compare canonical keys so `"Storage: <sub>"` and `"Storage:<sub>"`
    // count as the same binding (matching `parseAzureRemediationMap`,
    // which stores the canonical form). Otherwise two spellings of one
    // binding would pass here and collapse silently on read.
    const key = normalizeAzureRemediationKey(rawKey);
    if (!key) {
      return `azureRemediation["${rawKey}"]: keys must be "<AssetClass>:<subscription>" with a valid Azure subscription id.`;
    }
    if (seen.has(key)) {
      return `azureRemediation["${key}"]: duplicate key after trimming whitespace.`;
    }
    seen.add(key);
    if (
      typeof appId !== 'string' ||
      !AZURE_REMEDIATOR_SP_APP_ID_PATTERN.test(appId.trim().toLowerCase())
    ) {
      return `azureRemediation["${key}"]: must be a service-principal application (client) ID (GUID).`;
    }
  }
  return null;
}
