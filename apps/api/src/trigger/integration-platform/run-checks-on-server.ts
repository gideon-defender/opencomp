import type { runAllChecks } from '@gideon-defender/integration-platform';
import { ConnectionCheckRunnerService } from '../../integration-platform/services/connection-check-runner.service';
import {
  getTriggerService,
  logTriggerAuditEntry,
  triggerHttpErrorMessage,
} from '../nest-context';

export type RunAllChecksResult = Awaited<ReturnType<typeof runAllChecks>>;

// Generous backstop for a hung connection (no response). AWS checks legitimately
// take minutes across many buckets/regions, so this is deliberately well below
// the task's 15-minute maxDuration but high enough never to abort a real run —
// it only catches a stalled run so the error surfaces and the task retries
// instead of blocking the whole 15 minutes.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Run a connection's checks ON OUR SERVER (the API process) and return the raw
 * result.
 *
 * Used by the AWS Trigger tasks only: AWS S3 calls made from the Local trigger
 * runtime egress Local trigger's VPC, whose endpoint policy blocks our
 * cross-account reads. Running them via the API's service egresses our own VPC
 * (where the endpoint allows the read) — matching the in-app manual "Run". The
 * caller still persists the returned result, so AWS runs are recorded exactly
 * like every other provider's.
 *
 * Runs in-process through the Nest container (workers share the API process),
 * not over HTTP — same handler, no socket, no service token.
 *
 * Pass `checkId` to run a single check (scheduled path); omit it to run all of
 * the connection's checks (auto-run-after-connect path).
 *
 * Throws on a failure (endpoint unreachable / non-2xx equivalent) so the
 * caller's existing try/catch handles it (the task fails and the orchestrator
 * retries). Per-check execution errors come back inside the result as usual.
 */
export async function runChecksOnServer(params: {
  connectionId: string;
  organizationId: string;
  checkId?: string;
}): Promise<RunAllChecksResult> {
  const { connectionId, organizationId, checkId } = params;

  const runner = getTriggerService(ConnectionCheckRunnerService);
  const run = runner.runChecks({ connectionId, organizationId, checkId });

  // The timeout only rejects the race — the underlying run keeps going in the
  // background (no socket to abort in-process), same observable behavior for
  // the caller as the old HTTP abort.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Server-side check run timed out after ${REQUEST_TIMEOUT_MS}ms`,
        ),
      );
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([run, timeout]);

    // In-process calls skip the global AuditLogInterceptor — write the row
    // the internal run-connection-checks endpoint would have produced.
    await logTriggerAuditEntry({
      organizationId,
      resource: 'integration',
      method: 'POST',
      path: `/v1/integrations/internal/run-connection-checks/${connectionId}`,
    });

    return result;
  } catch (error) {
    throw new Error(triggerHttpErrorMessage(error));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
