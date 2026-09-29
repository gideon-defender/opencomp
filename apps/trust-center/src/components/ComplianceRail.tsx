import { statusLabel, type FrameworkStatus } from '@/lib/api';
import { Check } from 'lucide-react';
import { FrameworkShield } from './FrameworkShield';

export interface RailFramework {
  key: string;
  title: string;
  status: FrameworkStatus;
  badgeUrl?: string | null;
}

function StatusPill({ status }: { status: FrameworkStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
      <Check size={12} className="text-success" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

/**
 * Left-rail compliance card: framework rows with mini shield badges and
 * status pills.
 */
export function ComplianceRail({ frameworks }: { frameworks: RailFramework[] }) {
  const allActive = frameworks.length > 0;
  return (
    <section
      aria-label="Compliance frameworks"
      className="rounded-lg border border-line bg-surface p-6"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Compliance</h2>
        {allActive && <span className="text-sm text-muted">All active</span>}
      </div>
      {frameworks.length === 0 ? (
        <p className="mt-4 text-[15px] text-muted">No frameworks published yet.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {frameworks.map((framework) => (
            <li key={framework.key} className="flex items-center gap-2">
              {framework.badgeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={framework.badgeUrl}
                  alt=""
                  className="h-14 w-11 shrink-0 rounded object-contain"
                  loading="lazy"
                />
              ) : (
                <FrameworkShield
                  title={framework.title}
                  inProgress={framework.status === 'in_progress'}
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{framework.title}</p>
                <div className="mt-1">
                  <StatusPill status={framework.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
