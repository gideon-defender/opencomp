import type { ReactNode } from 'react';

/**
 * Generic content card: count pill + title + description + item list.
 * Used for Policies, Controls, Subprocessors, and Resources sections.
 */
export function StatSection({
  id,
  count,
  title,
  description,
  children,
  viewAllHref,
}: {
  id: string;
  count: number;
  title: string;
  description: string;
  children: ReactNode;
  viewAllHref?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="scroll-mt-24 rounded-lg border border-line bg-surface p-6 md:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-muted tabular-nums">
              {count}
            </span>
            <h2 className="text-2xl font-semibold md:text-[28px]">{title}</h2>
          </div>
          <p className="mt-1 max-w-[760px] text-[15px] text-muted">{description}</p>
        </div>
        {viewAllHref && (
          <a
            href={viewAllHref}
            className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-line px-4 text-sm font-medium transition-colors hover:border-muted"
          >
            View all
          </a>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Two-column bullet list with muted dots. */
export function BulletList({
  items,
  initialVisible = 8,
}: {
  items: string[];
  initialVisible?: number;
}) {
  if (items.length === 0) {
    return <p className="text-[15px] text-muted">Nothing published yet.</p>;
  }
  const visible = items.slice(0, initialVisible);
  const hidden = items.slice(initialVisible);
  const list = (entries: string[]) => (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
      {entries.map((item) => (
        <li key={item} className="flex items-start gap-2 text-[15px]">
          <span
            aria-hidden="true"
            className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted"
          />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
  if (hidden.length === 0) return list(visible);
  return (
    <div>
      {list(visible)}
      <details className="group mt-3">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-md border border-line px-4 text-sm font-medium transition-colors hover:border-muted [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show all {items.length}</span>
          <span className="hidden group-open:inline">Show less</span>
        </summary>
        <div className="mt-3">{list(hidden)}</div>
      </details>
    </div>
  );
}
