/**
 * Azure subscription IDs are GUIDs (or the literal `subscriptions` alias is
 * never valid). Validating the shape before it is interpolated into a
 * management.azure.com URL prevents path injection: an unvalidated value such
 * as `../<other-id>` would retarget the request path while still carrying the
 * caller's bearer token.
 */
const AZURE_SUBSCRIPTION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidAzureSubscriptionId(value: unknown): value is string {
  return typeof value === 'string' && AZURE_SUBSCRIPTION_ID_PATTERN.test(value);
}

/**
 * Validate an Azure subscription ID and return it, or `null` when it is
 * missing or malformed. Callers must treat `null` as "cannot build a request".
 */
export function normalizeAzureSubscriptionId(value: unknown): string | null {
  return isValidAzureSubscriptionId(value) ? value : null;
}
