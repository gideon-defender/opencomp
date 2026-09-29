import { FileText, Layers, ShieldCheck } from 'lucide-react';

/**
 * Anchor tabs: Overview / Security Controls / Subprocessors. They scroll to
 * the matching section.
 */
export function PortalTabs({ showControls }: { showControls: boolean }) {
  const tabs = [
    { href: '#overview', label: 'Overview', icon: Layers },
    ...(showControls ? [{ href: '#controls', label: 'Security controls', icon: ShieldCheck }] : []),
    { href: '#subprocessors', label: 'Subprocessors', icon: FileText },
  ];
  return (
    <nav aria-label="Trust center sections" className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((tab, index) => (
          <li key={tab.href}>
            <a
              href={tab.href}
              className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[15px] transition-colors ${
                index === 0
                  ? 'border-primary font-semibold text-ink'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <tab.icon size={15} aria-hidden="true" />
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
