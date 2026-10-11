import { Logger } from '@nestjs/common';
import { db, Prisma } from '@db';

/** Minimal raw-SQL surface used for legacy impersonation handling. Generic
 * `$queryRaw` keeps the column-exists probe and the marker check on one
 * client type (the Prisma schema no longer declares the column). */
interface LegacySessionRawClient {
  $queryRaw?: <T>(query: unknown) => Promise<T[]>;
  $executeRaw?: (query: unknown) => Promise<number>;
}

export class LegacySessionRevocation {
  private readonly logger = new Logger(LegacySessionRevocation.name);

  /**
   * One-shot revocation of legacy impersonation sessions.
   *
   * Platform-admin impersonation was removed: nothing reads
   * `Session.impersonatedBy` anymore, so a surviving impersonated row
   * authenticates as its victim with no audit marker. Delete those rows
   * at boot via raw SQL (the Prisma schema no longer declares the
   * column, so the generated client cannot name it).
   *
   * Boot cleanup is best-effort with retries — a skipped cleanup must not
   * block startup. The request-time check in `resolveToken` is the real
   * guard: it rejects surviving impersonated rows until the column is
   * provably dropped, so a missed boot cleanup only costs a log line.
   */
  async onModuleInit(): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const client = db as unknown as LegacySessionRawClient;
        if (
          typeof client.$queryRaw !== 'function' ||
          typeof client.$executeRaw !== 'function'
        ) {
          return;
        }
        const columnExists = await this.hasImpersonationColumn(client);
        if (columnExists === null)
          throw new Error('Impersonation column state is unknown');
        if (!columnExists) return;
        const deleted = await client.$executeRaw(Prisma.sql`
          DELETE FROM "Session" WHERE "impersonatedBy" IS NOT NULL
        `);
        if (deleted > 0) {
          this.logger.log(`Revoked ${deleted} legacy impersonation session(s)`);
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isColumnMissingError(message)) {
          // Column dropped mid-boot (promotion race): the marker is gone,
          // which is the desired end state. Record it and stop quietly —
          // the FAILED log below is for real failures, not this race.
          this.impersonationColumnKnown = false;
          this.logger.log(
            'Legacy impersonation column already dropped — no cleanup needed.',
          );
          return;
        }
        if (attempt === maxAttempts) {
          this.logger.error(
            `Legacy impersonation-session cleanup FAILED after ${maxAttempts} attempts: ${message}. ` +
              `Surviving impersonated rows are still rejected per-request until the column is dropped.`,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Cached existence probe for the legacy `Session.impersonatedBy` column.
   * Once the phase-3 migration drops the column this stays false and the
   * per-request raw check below is skipped entirely.
   */
  private impersonationColumnKnown: boolean | null = null;

  private async hasImpersonationColumn(
    client: LegacySessionRawClient,
  ): Promise<boolean | null> {
    if (this.impersonationColumnKnown !== null) {
      return this.impersonationColumnKnown;
    }
    try {
      const columns = await client.$queryRaw!<{ exists: boolean }>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Session' AND column_name = 'impersonatedBy'
        ) AS "exists"
      `);
      // An empty or malformed result is ambiguous (driver quirk, not proof the column is
      // gone): do NOT cache it. Caching false here would permanently disable
      // the per-request guard for the process lifetime and let surviving
      // impersonated rows authenticate. The next call re-probes.
      if (typeof columns[0]?.exists !== 'boolean') {
        this.logger.error(
          'Impersonation-column probe returned no valid result — per-request guard degraded to fail-closed for this call; the next call re-probes.',
        );
        return null;
      }
      this.impersonationColumnKnown = columns[0]?.exists === true;
    } catch {
      // An unknown column state cannot prove that the session is safe.
      this.logger.error(
        'Impersonation-column probe failed — per-request guard degraded to fail-closed for this call; the next call re-probes.',
      );
      return null;
    }
    return this.impersonationColumnKnown;
  }

  /**
   * Request-time rejection of surviving impersonation sessions.
   *
   * Runs only while the legacy column still exists (cached probe above).
   * A row with `impersonatedBy` set authenticates as its victim with no
   * audit marker, so it is rejected here even if boot cleanup missed it
   * (failed boot, replica that never booted the new build, HOLD migration
   * not yet promoted). Returns true when the session must not authenticate.
   */
  async rejectsSession(sessionId: string): Promise<boolean> {
    const client = db as unknown as LegacySessionRawClient;
    if (typeof client.$queryRaw !== 'function') return true;
    const columnExists = await this.hasImpersonationColumn(client);
    if (columnExists === null) return true;
    if (!columnExists) return false;
    try {
      const rows = await client.$queryRaw<{
        impersonatedBy: string | null;
      }>(Prisma.sql`
        SELECT "impersonatedBy" FROM "Session" WHERE id = ${sessionId}
      `);
      return rows[0]?.impersonatedBy != null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isColumnMissingError(message)) {
        // Column dropped mid-process (promotion race): the marker is gone,
        // so the session is clean. Cache that and skip future probes.
        this.impersonationColumnKnown = false;
        return false;
      }
      // The column is known to exist but the marker read failed: fail closed.
      // A transient outage must not re-admit a revoked impersonation session
      // as its victim. (When the probe itself fails the column state is
      // unknown — that path also rejects the session.)
      this.logger.error(
        `Impersonation marker check failed while the legacy column exists — rejecting session ${sessionId}: ${message}`,
      );
      return true;
    }
  }
}

/** True when a DB error means the legacy column is already dropped. */
function isColumnMissingError(message: string): boolean {
  return /does not exist|undefined column|unknown column/i.test(message);
}
