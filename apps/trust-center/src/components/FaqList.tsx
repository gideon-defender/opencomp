import type { PortalFaq } from '@/lib/api';

/**
 * FAQ accordions using native details/summary — no JS state needed and
 * fully keyboard accessible.
 */
export function FaqList({ faqs }: { faqs: PortalFaq[] }) {
  if (faqs.length === 0) return null;
  const sorted = [...faqs].sort((a, b) => a.order - b.order);
  return (
    <section
      aria-label="Frequently asked questions"
      className="rounded-lg border border-line bg-surface p-6 md:p-8"
    >
      <h2 className="text-2xl font-semibold">FAQ</h2>
      <div className="mt-3 divide-y divide-line">
        {sorted.map((faq) => (
          <details key={`${faq.order}-${faq.question}`} className="group py-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
              <span>{faq.question}</span>
              <span
                aria-hidden="true"
                className="text-lg leading-none text-muted transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-1 max-w-[760px] text-[15px] whitespace-pre-line text-muted">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
