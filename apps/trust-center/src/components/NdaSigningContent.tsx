import TrustCenterNotFound from '@/app/not-found';
import { NdaSigningForm } from '@/components/NdaSigningForm';
import { OrgLogo } from '@/components/OrgLogo';
import { TrustFooter } from '@/components/TrustFooter';
import type { NdaDetails } from '@/lib/api';
import { brandStyleFor } from '@/lib/branding';
import { isSafeHttpUrl } from '@/lib/urls';
import Link from 'next/link';

export function NdaSigningContent({
  nda,
  token,
  friendlyUrl,
}: {
  nda: NdaDetails;
  token: string;
  friendlyUrl?: string;
}) {
  // The lookup is token-only, so a wrong slug would render another org's
  // requester details under an unrelated URL — treat it as unknown.
  if (friendlyUrl && nda.friendlyUrl && nda.friendlyUrl !== friendlyUrl) {
    return <TrustCenterNotFound />;
  }

  // Portal links come from the backend and render as navigation targets:
  // only http(s) values become links, matching the sibling URL rule.
  const portalHref = isSafeHttpUrl(nda.portalUrl) ? nda.portalUrl : null;

  return (
    <div className="min-h-dvh bg-canvas" style={brandStyleFor(nda.primaryColor)}>
      <div className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6 md:py-16">
        <section className="rounded-lg border border-line bg-surface p-6 md:p-8">
          <div className="flex items-start gap-4">
            <OrgLogo name={nda.organizationName} logoUrl={nda.logoUrl} />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-muted">Non-disclosure agreement</p>
              <h1 className="mt-1 text-2xl leading-[1.15] font-bold md:text-3xl">
                {nda.organizationName}
              </h1>
              <p className="mt-1 text-sm text-muted">
                Prepared for {nda.requesterName} ({nda.requesterEmail})
              </p>
            </div>
          </div>

          <div className="mt-6">
            {nda.status === 'pending' && (
              <NdaSigningForm
                token={token}
                defaultName={nda.requesterName}
                defaultEmail={nda.requesterEmail}
              />
            )}

            {nda.status === 'signed' && (
              <div className="rounded-lg border border-line bg-canvas p-6 text-center">
                <h2 className="text-lg font-semibold">Already signed</h2>
                <p className="mt-1 text-sm text-muted">
                  {nda.message ?? 'This NDA has already been signed.'}
                </p>
                {portalHref ? (
                  <a
                    href={portalHref}
                    className="mt-4 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
                  >
                    Open trust portal
                  </a>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    Your access link arrives by email once the grant is ready.
                  </p>
                )}
              </div>
            )}

            {(nda.status === 'expired' || nda.status === 'void') && (
              <div className="rounded-lg border border-line bg-canvas p-6 text-center">
                <h2 className="text-lg font-semibold">
                  {nda.status === 'expired' ? 'Link expired' : 'NDA revoked'}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {nda.message ??
                    'This signing link is no longer valid. Ask the security team to resend it.'}
                </p>
                {nda.friendlyUrl && (
                  <Link
                    href={`/${nda.friendlyUrl}`}
                    className="mt-4 inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm font-semibold transition-colors hover:bg-surface"
                  >
                    Back to trust center
                  </Link>
                )}
              </div>
            )}

            {/* The backend can ship a status this page does not know yet — never render an empty box. */}
            {!['pending', 'signed', 'expired', 'void'].includes(nda.status) && (
              <div className="rounded-lg border border-line bg-canvas p-6 text-center">
                <h2 className="text-lg font-semibold">Link unavailable</h2>
                <p className="mt-1 text-sm text-muted">
                  {nda.message ??
                    'This signing link is no longer valid. Ask the security team to resend it.'}
                </p>
                {nda.friendlyUrl && (
                  <Link
                    href={`/${nda.friendlyUrl}`}
                    className="mt-4 inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm font-semibold transition-colors hover:bg-surface"
                  >
                    Back to trust center
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>

        <TrustFooter />
      </div>
    </div>
  );
}
