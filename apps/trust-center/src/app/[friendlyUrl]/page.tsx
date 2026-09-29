import { ComplianceRail } from '@/components/ComplianceRail';
import { FaqList } from '@/components/FaqList';
import { PortalTabs } from '@/components/PortalTabs';
import { StatMiniCards } from '@/components/StatMiniCards';
import { BulletList, StatSection } from '@/components/StatSection';
import { TrustFooter } from '@/components/TrustFooter';
import { TrustHero } from '@/components/TrustHero';
import { VendorRow } from '@/components/VendorRow';
import { trustApi } from '@/lib/api';
import { isSafeHttpUrl } from '@/lib/urls';
import { FileCheck, HelpCircle, ShieldCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ friendlyUrl: string }>;
}): Promise<Metadata> {
  const { friendlyUrl } = await params;
  const profile = await trustApi.profile(friendlyUrl).catch(() => null);
  if (!profile) return { title: 'Trust Center not found' };
  return {
    title: `${profile.organizationName} Trust Center`,
    description: 'Security, compliance, and trust documentation.',
  };
}

export default async function TrustCenterPage({
  params,
}: {
  params: Promise<{ friendlyUrl: string }>;
}) {
  const { friendlyUrl } = await params;
  // One failing section must not take down the whole page: every fetch
  // below degrades to its empty state instead of rejecting Promise.all.
  const [
    profile,
    frameworks,
    policies,
    controls,
    vendors,
    faqs,
    customLinks,
    overview,
    customFrameworks,
    questionnaireAvailable,
  ] = await Promise.all([
    trustApi.profile(friendlyUrl).catch(() => null),
    trustApi.frameworks(friendlyUrl).catch(() => []),
    trustApi.policies(friendlyUrl).catch(() => []),
    trustApi.controls(friendlyUrl).catch(() => []),
    trustApi.vendors(friendlyUrl).catch(() => []),
    trustApi.faqs(friendlyUrl).catch(() => []),
    trustApi.customLinks(friendlyUrl).catch(() => []),
    trustApi.overview(friendlyUrl).catch(() => null),
    trustApi.customFrameworks(friendlyUrl).catch(() => []),
    trustApi.questionnaireEnabled(friendlyUrl).catch(() => true),
  ]);

  if (!profile) notFound();

  const railFrameworks = [
    ...frameworks.map((framework) => ({
      key: framework.key,
      title: framework.title,
      status: framework.status,
      badgeUrl: null as string | null,
    })),
    ...customFrameworks.map((framework) => ({
      key: framework.id,
      title: framework.name,
      status: framework.status,
      badgeUrl: framework.badgeUrl,
    })),
  ];
  const showControls = controls.length > 0;
  // Count what the section actually renders: non-http(s) stored URLs are
  // filtered from the list by design.
  const safeCustomLinks = customLinks.filter((link) => isSafeHttpUrl(link.url));

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-7xl px-4 pt-12 pb-12 md:px-6 md:pt-20 md:pb-16">
          <TrustHero
            profile={profile}
            friendlyUrl={friendlyUrl}
            policyCount={policies.length}
            questionnaireAvailable={questionnaireAvailable}
          />
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 md:px-6">
        <div className="py-4">
          <PortalTabs showControls={showControls} />
        </div>

        <div
          id="overview"
          className="grid scroll-mt-24 grid-cols-1 gap-6 pb-4 lg:grid-cols-[320px_minmax(0,1fr)]"
        >
          <div className="space-y-6">
            <ComplianceRail frameworks={railFrameworks} />
            <StatMiniCards
              stats={[
                { label: 'Frameworks', value: railFrameworks.length, Icon: ShieldCheck },
                { label: 'Policies', value: policies.length, Icon: FileCheck },
                { label: 'Subprocessors', value: vendors.length, Icon: Users },
                { label: 'FAQs', value: faqs.length, Icon: HelpCircle },
              ]}
            />
          </div>

          <div className="min-w-0 space-y-6 md:space-y-8">
            {overview && (
              <section
                aria-label="Overview"
                className="rounded-lg border border-line bg-surface p-6 md:p-8"
              >
                {overview.title && <h2 className="text-2xl font-semibold">{overview.title}</h2>}
                {overview.content && (
                  <p className="mt-2 max-w-[760px] text-[15px] whitespace-pre-line text-muted">
                    {overview.content}
                  </p>
                )}
              </section>
            )}

            <StatSection
              id="policies"
              count={policies.length}
              title="Policies"
              description="Internal policies that govern how we operate and protect customer data."
            >
              <BulletList items={policies.map((policy) => policy.name)} />
            </StatSection>

            {showControls && (
              <StatSection
                id="controls"
                count={controls.length}
                title="Controls"
                description="Safeguards continuously monitored across our infrastructure and processes."
              >
                <BulletList items={controls.map((control) => control.name)} />
              </StatSection>
            )}

            <StatSection
              id="subprocessors"
              count={vendors.length}
              title="Subprocessors"
              description="Third parties that process data on our behalf under strict contractual safeguards."
            >
              {vendors.length === 0 ? (
                <p className="text-[15px] text-muted">Nothing published yet.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-line">
                  {vendors.map((vendor) => (
                    <VendorRow key={vendor.id} vendor={vendor} />
                  ))}
                </div>
              )}
            </StatSection>

            {safeCustomLinks.length > 0 && (
              <StatSection
                id="resources"
                count={safeCustomLinks.length}
                title="Resources"
                description="Additional links shared by the security team."
              >
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {safeCustomLinks.map((link) => (
                    <li key={link.id}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">
                            {link.title}
                          </span>
                          {link.description && (
                            <span className="block truncate text-sm text-muted">
                              {link.description}
                            </span>
                          )}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-muted">
                          ↗
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </StatSection>
            )}

            <FaqList faqs={faqs} />
          </div>
        </div>
      </div>

      <TrustFooter />
    </div>
  );
}
