'use client';

import { useState } from 'react';
import { useFrameworkUpdatesNudge } from './FrameworkUpdatesNudge';
import { NudgeCenter } from './NudgeCenter';
import { useOffboardingNudge } from './OffboardingNudge';
import { useTrustPortalSetupNudge } from './TrustPortalSetupNudge';
import type { NudgeState, ServerNudgeData } from './types';

const dismissKey = (id: string, orgId: string) => `overview-nudge-dismissed:${id}:${orgId}`;

// Read synchronously (SSR-guarded) so a returning visitor never flashes a
// previously dismissed nudge, and tests see mount output without awaiting.
function readPersistedDismissals(persistableIds: string, orgId: string): Set<string> {
  const next = new Set<string>();
  if (typeof window === 'undefined') return next;
  for (const id of persistableIds.split(',').filter(Boolean)) {
    if (window.localStorage.getItem(dismissKey(id, orgId)) === '1') {
      next.add(id);
    }
  }
  return next;
}

export function OverviewNudges({ orgId, server }: { orgId: string; server: ServerNudgeData }) {
  // Hooks called unconditionally, in stable priority order.
  const offboarding = useOffboardingNudge();
  const frameworkUpdates = useFrameworkUpdatesNudge();
  const trust = useTrustPortalSetupNudge({ orgId, server });
  const candidates = [offboarding, frameworkUpdates, trust];

  // Stable across renders unless a persistable nudge is added/removed.
  const persistableIds = candidates
    .filter((c) => c.persistDismissal)
    .map((c) => c.id)
    .join(',');

  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    readPersistedDismissals(persistableIds, orgId),
  );
  const [expanded, setExpanded] = useState(false);

  // Reload persisted dismissals when the persistable set changes (e.g. data
  // finishing loading reveals a new persistable nudge). Adjust-during-render
  // instead of an effect to avoid setState-in-effect.
  const persistKey = `${orgId}:${persistableIds}`;
  const [prevPersistKey, setPrevPersistKey] = useState(persistKey);
  if (prevPersistKey !== persistKey) {
    setPrevPersistKey(persistKey);
    setDismissed(readPersistedDismissals(persistableIds, orgId));
  }

  const visible = candidates
    .filter((c) => c.ready && c.eligible && !dismissed.has(c.id))
    .sort((a, b) => a.priority - b.priority);

  // Collapse the tray whenever there's no longer more than one to fan out.
  // Adjust-during-render instead of an effect to avoid setState-in-effect.
  if (visible.length <= 1 && expanded) {
    setExpanded(false);
  }

  if (visible.length === 0) return null;

  const dismiss = (nudge: NudgeState) => () => {
    if (nudge.persistDismissal) {
      window.localStorage.setItem(dismissKey(nudge.id, orgId), '1');
    }
    setDismissed((prev) => new Set(prev).add(nudge.id));
  };

  const body =
    visible.length === 1 ? (
      visible[0].render(dismiss(visible[0]))
    ) : (
      <NudgeCenter
        count={visible.length}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
      >
        {(expanded ? visible : visible.slice(0, 1)).map((nudge) => (
          <div key={nudge.id}>{nudge.render(dismiss(nudge))}</div>
        ))}
      </NudgeCenter>
    );

  // Match the page's centered content width so nudges align with everything else.
  return <div className="mx-auto w-full max-w-[1200px] pb-6">{body}</div>;
}
