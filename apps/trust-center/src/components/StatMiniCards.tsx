import { ShieldCheck } from 'lucide-react';

export interface Stat {
  label: string;
  value: number;
  Icon: typeof ShieldCheck;
}

/**
 * 2-up stat mini-cards under the compliance rail.
 */
export function StatMiniCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:gap-6">
      {stats.map(({ label, value, Icon }) => (
        <div key={label} className="rounded-lg border border-line bg-surface p-4 md:p-6">
          <Icon size={20} aria-hidden="true" className="text-ink" />
          <p className="mt-3 text-xl font-bold tabular-nums">{value}</p>
          <p className="text-sm text-muted">{label}</p>
        </div>
      ))}
    </div>
  );
}
