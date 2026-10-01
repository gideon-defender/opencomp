import type { PortalProfile } from '@/lib/api';
import { BookOpenCheck, ExternalLink, FileCheck } from 'lucide-react';
import { OrgLogo } from './OrgLogo';
import { RequestAccessActions } from './RequestAccessActions';

/**
 * Hero: org tile, verified label, title, lede, action buttons, and the
 * meta row. Plain white surface, no gradient washes or shadows.
 */
export function TrustHero({
  profile,
  friendlyUrl,
  policyCount,
  questionnaireAvailable,
}: {
  profile: PortalProfile;
  friendlyUrl: string;
  policyCount: number;
  questionnaireAvailable: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-6 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <OrgLogo name={profile.organizationName} logoUrl={profile.logoUrl} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-muted">
              Verified
              {profile.domainVerified && profile.domain ? ` • ${profile.domain}` : ''}
            </p>
            <h1 className="mt-1 text-3xl leading-[1.15] font-bold md:text-5xl md:leading-[1.1]">
              {profile.organizationName} Trust Center
            </h1>
            <p className="mt-2 text-[15px] text-muted md:text-base">
              Compliance and security overview
            </p>
          </div>
        </div>
        <RequestAccessActions
          friendlyUrl={friendlyUrl}
          organizationName={profile.organizationName}
          questionnaireAvailable={questionnaireAvailable}
        />
      </div>
      <p className="mt-5 max-w-[760px] text-[15px] leading-relaxed text-muted md:text-base">
        This Trust Center provides transparent visibility into {profile.organizationName}&apos;s
        security, compliance, governance, and trust documentation.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <BookOpenCheck size={15} aria-hidden="true" />
          <strong className="font-semibold text-ink">{policyCount}</strong> Policies
        </span>
        {questionnaireAvailable && (
          <span className="inline-flex items-center gap-1.5">
            <FileCheck size={15} aria-hidden="true" />
            Questionnaire <strong className="font-semibold text-ink">available</strong>
          </span>
        )}
        <a
          href="https://www.gideondefender.com/en/products/open-source/opencomp/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-ink sm:ml-auto"
        >
          OpenComp by Gideon Defender
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
