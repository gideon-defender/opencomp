/**
 * Execute-time pre-flight checks for Azure remediation (Phase A).
 *
 * Pure functions (no Nest coupling) so the fail-closed behavior is
 * unit-testable without the service. Every check throws on failure —
 * including when the check itself cannot run. A pre-flight that warns
 * and proceeds would execute writes on unverified assumptions; worse,
 * the old behavior told operators to grant Contributor, the exact grant
 * the trust probe refuses at binding time.
 */

/**
 * Confirm the executor token holds a write grant at subscription scope
 * before any fix or rollback step runs. Throws when the grant is absent
 * AND when the check call itself fails — both mean "write access is
 * unproven", and unproven writes do not run.
 */
export async function checkAzureWriteAccess(params: {
  accessToken: string;
  subscriptionId: string;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const fetchFn = params.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(
      `https://management.azure.com/subscriptions/${params.subscriptionId}` +
        `/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`,
      { headers: { Authorization: `Bearer ${params.accessToken}` } },
    );
  } catch (err) {
    throw new Error(
      `Pre-flight permission check unreachable — refusing to execute without proven write access: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Pre-flight permission check failed (${response.status}) — refusing to execute without proven write access. Re-run the setup script for this pair.`,
    );
  }
  const data = (await response.json()) as {
    value?: Array<{ actions?: string[] }>;
  };
  const allActions = (data.value ?? []).flatMap((entry) =>
    Array.isArray(entry.actions) ? entry.actions : [],
  );
  const hasWrite = allActions.some(
    (action) =>
      action === '*' || action === '*/write' || action.endsWith('/write'),
  );
  if (!hasWrite) {
    throw new Error(
      'Pre-flight: executor identity holds no write grant on this subscription — refusing to execute. Re-run the setup script for this pair.',
    );
  }
}
