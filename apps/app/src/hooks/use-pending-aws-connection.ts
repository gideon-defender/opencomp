'use client';

import type { ConnectionListItemResponse } from '@gideon-defender/integration-platform';
import { useCallback, useEffect, useState } from 'react';

/** A pending AWS connection minted in phase 1 to issue its External ID. */
export interface PendingAwsConnection {
  id: string;
  externalId: string;
}

function storageKey(orgId: string, providerId: string): string {
  return `pending-aws-connection:${orgId}:${providerId}`;
}

function isPendingAwsConnection(value: unknown): value is PendingAwsConnection {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.externalId === 'string' &&
    candidate.externalId.length > 0
  );
}

function readStored(orgId: string, providerId: string): PendingAwsConnection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(orgId, providerId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingAwsConnection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(orgId: string, providerId: string, value: PendingAwsConnection): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(orgId, providerId), JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the in-memory value still works.
  }
}

function clearStored(orgId: string, providerId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey(orgId, providerId));
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Newest pending connection for the provider that already carries an
 * External ID in metadata. Used to resume after the tab closes, where
 * session storage is gone but the server-side row survives.
 */
export function newestPendingFromList(
  connections: ConnectionListItemResponse[],
  providerId: string,
): PendingAwsConnection | null {
  const candidates = connections
    .filter((connection) => {
      if (connection.providerSlug !== providerId || connection.status !== 'pending') {
        return false;
      }
      const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
      return typeof metadata.externalId === 'string' && metadata.externalId.length > 0;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newest = candidates[0];
  if (!newest) return null;
  const metadata = (newest.metadata ?? {}) as Record<string, unknown>;
  return { id: newest.id, externalId: metadata.externalId as string };
}

/**
 * Owns the phase-1 pending AWS connection across refreshes and dialog
 * close/reopen. The show-once External ID survives in session storage, and
 * when the tab is gone the newest pending row (whose metadata carries the
 * minted value) is adopted — so resuming never mints a duplicate row.
 */
export function usePendingAwsConnection({
  orgId,
  providerId,
  connections,
}: {
  orgId: string;
  providerId: string;
  connections?: ConnectionListItemResponse[];
}): {
  pendingConnection: PendingAwsConnection | null;
  setPendingConnection: (value: PendingAwsConnection) => void;
  clearPendingConnection: () => void;
} {
  // Explicit value from setPendingConnection (phase 1 just minted).
  const [manual, setManual] = useState<PendingAwsConnection | null>(null);
  // Scope dismissed via clearPendingConnection (phase 2 completed): a later
  // connections refetch must not resurrect the cleared row.
  const [dismissedScope, setDismissedScope] = useState<string | null>(null);
  // Current scope, adjusted during render when org/provider change (an org
  // switch reuses the mount): a stale value from the previous scope must
  // never display under the new one.
  const scopeKey = `${orgId}:${providerId}`;
  const [scope, setScope] = useState(scopeKey);
  if (scope !== scopeKey) {
    setScope(scopeKey);
    setManual(null);
  }

  // Derived recovery (no state synchronization effect needed): the
  // show-once value survives in session storage, and when the tab is gone
  // the newest pending row (whose metadata carries the minted value) is
  // adopted — so resuming never mints a duplicate. A row that arrives via a
  // later refetch is picked up on the next render.
  const stored = readStored(orgId, providerId);
  const match = connections ? newestPendingFromList(connections, providerId) : null;
  // Persist an adopted list row for the next refresh. Storage-only effect:
  // no setState inside, so later renders stay cascade-free.
  useEffect(() => {
    if (match && !stored) {
      writeStored(orgId, providerId, match);
    }
  }, [match, stored, orgId, providerId]);
  const pendingConnection = dismissedScope === scopeKey ? null : (manual ?? stored ?? match);

  const setPendingConnection = useCallback(
    (value: PendingAwsConnection) => {
      writeStored(orgId, providerId, value);
      // A fresh phase-1 mint supersedes any earlier dismissal in this scope:
      // without this, a second connect in the same mount stays suppressed
      // and every attempt mints another orphan pending row.
      setDismissedScope(null);
      setManual(value);
    },
    [orgId, providerId],
  );

  const clearPendingConnection = useCallback(() => {
    clearStored(orgId, providerId);
    setDismissedScope(scopeKey);
    setManual(null);
  }, [orgId, providerId, scopeKey]);

  return { pendingConnection, setPendingConnection, clearPendingConnection };
}
