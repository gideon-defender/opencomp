/**
 * Binds an execute call to the just-previewed plan.
 *
 * AWS/GCP previews carry `planHash` and their execute endpoints refuse
 * without it — the spread below forwards it. Azure previews carry no
 * hash and Azure execute needs none, so absence means "omit", never
 * "fail": every caller already routes guided-only and missing-permission
 * previews away before reaching execute.
 */
export function expectedPlanHashParam(
  preview: { planHash?: string } | null | undefined,
): { expectedPlanHash: string } | Record<string, never> {
  return preview?.planHash ? { expectedPlanHash: preview.planHash } : {};
}
