import { TrustFooter } from '@/components/TrustFooter';
import { FRAMEWORK_TITLES, publicApiBase, trustApi } from '@/lib/api';
import { Download, FileCheck, FileText, ShieldCheck } from 'lucide-react';
import { notFound } from 'next/navigation';

function SectionCard({
  count,
  title,
  description,
  children,
}: {
  count: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-surface p-5 md:p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">{count}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium transition-colors hover:bg-canvas"
    >
      <Download size={15} aria-hidden="true" />
      {label}
    </a>
  );
}

export default async function GrantAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let base: string;
  try {
    base = publicApiBase();
  } catch {
    notFound();
  }

  let grant = null;
  try {
    grant = await trustApi.grant(token);
  } catch {
    grant = null;
  }
  if (!grant) notFound();

  // A 500 here means the token check itself failed — render 404 instead
  // of crashing the page.
  // Each section degrades to [] on its own failure so one bad section does
  // not hide the sections that loaded (same pattern as the public page).
  const [policies, resources, documents] = await Promise.all([
    trustApi.grantPolicies(token).catch(() => []),
    trustApi.grantResources(token).catch(() => []),
    trustApi.grantDocuments(token).catch(() => []),
  ]);

  // The grant may have been revoked or expired between the check above
  // and these reads (each 404 degrades to []). Revalidate once when every
  // section comes back empty so a dead grant never renders as a live page.
  if (policies.length === 0 && resources.length === 0 && documents.length === 0) {
    const stillValid = await trustApi.grant(token).catch(() => null);
    if (!stillValid) notFound();
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-7xl px-4 pt-12 pb-12 md:px-6 md:pt-20 md:pb-16">
          <section className="rounded-lg border border-line bg-surface p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white"
              >
                {(grant.organizationName[0] ?? '?').toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-muted">Granted access</p>
                <h1 className="mt-1 text-3xl leading-[1.15] font-bold md:text-5xl md:leading-[1.1]">
                  {grant.organizationName} Trust Center
                </h1>
                <p className="mt-1 text-sm text-muted">
                  Shared with {grant.subjectEmail} • expires{' '}
                  {new Date(grant.expiresAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-10 md:space-y-8 md:px-6 md:py-16">
        <SectionCard
          count={policies.length}
          title="Policies"
          description="Compliance policies shared with you."
        >
          {policies.length === 0 ? (
            <p className="text-sm text-muted">No policies shared.</p>
          ) : (
            <>
              <div className="mb-4">
                <DownloadLink
                  href={`${base}/v1/trust-access/access/${encodeURIComponent(token)}/policies/download-all-zip`}
                  label="Download all as ZIP"
                />
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {policies.map((policy) => (
                  <li key={policy.id} className="flex items-center gap-3 px-4 py-3">
                    <FileCheck size={18} aria-hidden="true" className="shrink-0 text-success" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {policy.name}
                    </span>
                    <DownloadLink
                      href={`${base}/v1/trust-access/access/${encodeURIComponent(token)}/policies/${encodeURIComponent(policy.id)}/download`}
                      label="PDF"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard
          count={resources.length}
          title="Certificates"
          description="Compliance certificates shared with you."
        >
          {resources.length === 0 ? (
            <p className="text-sm text-muted">No certificates shared.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {resources.map((resource, index) => {
                const key = resource.framework ?? resource.customFrameworkId ?? `res-${index}`;
                const label = resource.framework
                  ? (Object.hasOwn(FRAMEWORK_TITLES, resource.framework)
                      ? FRAMEWORK_TITLES[resource.framework]
                      : resource.framework)
                  : resource.fileName;
                // A resource with neither identifier has no download
                // endpoint — render the label without a dead link.
                const href = resource.framework
                  ? `${base}/v1/trust-access/access/${encodeURIComponent(token)}/compliance-resources/${encodeURIComponent(resource.framework)}`
                  : resource.customFrameworkId
                    ? `${base}/v1/trust-access/access/${encodeURIComponent(token)}/compliance-resources/custom/${encodeURIComponent(resource.customFrameworkId)}`
                    : null;
                return (
                  <li key={key} className="flex items-center gap-3 px-4 py-3">
                    <ShieldCheck size={18} aria-hidden="true" className="shrink-0 text-success" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
                    {href ? (
                      <DownloadLink href={href} label="PDF" />
                    ) : (
                      <span className="shrink-0 text-sm text-muted">Unavailable</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          count={documents.length}
          title="Documents"
          description="Additional documents shared with you."
        >
          {documents.length === 0 ? (
            <p className="text-sm text-muted">No documents shared.</p>
          ) : (
            <>
              <div className="mb-4">
                <DownloadLink
                  href={`${base}/v1/trust-access/access/${encodeURIComponent(token)}/documents/download-all`}
                  label="Download all"
                />
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText size={18} aria-hidden="true" className="shrink-0 text-success" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{document.name}</span>
                      {document.description && (
                        <span className="block truncate text-sm text-muted">
                          {document.description}
                        </span>
                      )}
                    </span>
                    <DownloadLink
                      href={`${base}/v1/trust-access/access/${encodeURIComponent(token)}/documents/${encodeURIComponent(document.id)}`}
                      label="File"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <TrustFooter />
      </div>
    </div>
  );
}
