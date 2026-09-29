import { DailyQuotaError, isDailyQuotaExhausted } from '@/lib/llm-call';
import { db } from '@db/server';
import { logger } from '@gideon-defender/trigger-local';

/**
 * Durable deferral for onboarding LLM work that failed on transient
 * provider limits. Instead of failing the onboarding run — which forced
 * users to manually press "Retry" — the failed unit of work is parked in
 * `OnboardingDeferredWork` and re-executed by the
 * `onboarding-deferred-sweeper` schedule once the quota window clears.
 *
 * Callers wrap a task's body with `runOrDeferOnboardingWork`: on a
 * transient failure the task returns normally, so the parent run stays
 * green while the tracker keeps showing the item as pending background
 * work (its metadata counters were never incremented).
 */

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'ENOTFOUND',
  'EPROTO',
]);

/** Transient failures worth deferring (quota + network/TLS + provider 5xx). */
export function isTransientLlmFailure(error: unknown): boolean {
  // Fail-fast daily-cap errors thrown by llm-call are exactly the case this
  // module exists for — defer them to the next quota reset.
  if (error instanceof DailyQuotaError) return true;
  if (isDailyQuotaExhausted(error)) return true;
  const message = error instanceof Error ? `${error.message}` : String(error);
  if (/socket|tls|network|disconnected|timeout/i.test(message)) return true;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

function laHourAt(instant: Date): number {
  // NOTE: 'en-US' here is computation-only (numeric hour extraction for the
  // Pacific-midnight quota reset), never user-facing. It must stay a fixed
  // locale so the non-digit strip below parses reliably.
  return (
    Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false,
      })
        .format(instant)
        .replace(/\D/g, ''),
    ) % 24
  );
}

/** Next Gemini free-tier daily-quota reset: upcoming midnight Pacific (+ buffer). */
function nextQuotaResetAt(now = new Date()): Date {
  // Walk forward in 1h steps until LA local time is past midnight, then land
  // ~30 min past it so we never race the reset edge.
  let candidate = now;
  for (let i = 0; i < 48 && laHourAt(candidate) >= 2; i += 1) {
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
  }
  return new Date(candidate.getTime() + 30 * 60 * 1000);
}

/** Exponential delay for non-quota transient failures: 15m → 1h → 6h → 24h cap. */
function networkRetryDelay(attempts: number): number {
  const hours = Math.min(0.25 * 4 ** attempts, 24);
  return hours * 60 * 60 * 1000;
}

/**
 * Persist a failed unit of onboarding work for later re-execution by the
 * sweeper. Upserts on dedupeKey so repeated failures refresh the row
 * instead of piling up duplicates.
 */
export async function deferOnboardingWork(params: {
  organizationId: string;
  taskId: string;
  /** Stable identity: kind + entity id/name (e.g. "risk:rsk_123"). */
  dedupeKey: string;
  payload: Record<string, unknown>;
  error: unknown;
}): Promise<void> {
  const { organizationId, taskId, dedupeKey, payload, error } = params;
  const daily = isDailyQuotaExhausted(error);
  try {
    const existing = await db.onboardingDeferredWork.findUnique({
      where: { dedupeKey },
      select: { attempts: true },
    });
    const attempts = (existing?.attempts ?? 0) + 1;
    const nextAttemptAt = daily
      ? nextQuotaResetAt()
      : new Date(Date.now() + networkRetryDelay(attempts));
    await db.onboardingDeferredWork.upsert({
      where: { dedupeKey },
      create: {
        organizationId,
        taskId,
        dedupeKey,
        payload: payload as object,
        attempts,
        nextAttemptAt,
        lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
      },
      update: {
        attempts,
        nextAttemptAt,
        lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
      },
    });
    logger.warn(
      `[onboarding] deferred ${dedupeKey} until ${nextAttemptAt.toISOString()} (${daily ? 'daily quota' : 'transient'}), attempt ${attempts}`,
    );
  } catch (deferErr) {
    // Deferral must never mask the original failure hard enough to crash
    // the task outside the transient classification.
    logger.error('[onboarding] failed to defer work', { deferErr });
  }
}

/**
 * Runs a unit of onboarding work, deferring it instead of failing when the
 * LLM provider hits transient limits. Returns `{ deferred: true }` when the
 * work was parked for the sweeper.
 */
export async function runOrDeferOnboardingWork<T>(params: {
  organizationId: string;
  taskId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T | { deferred: true }> {
  try {
    return await params.run();
  } catch (error) {
    if (!isTransientLlmFailure(error)) throw error;
    logger.warn(`[onboarding] transient LLM failure for ${params.dedupeKey}; deferring`, {
      error: error instanceof Error ? error.message : String(error),
    });
    await deferOnboardingWork({ ...params, error });
    return { deferred: true };
  }
}
