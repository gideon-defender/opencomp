import { activeMemberWhere } from '@/app/lib/active-member';
import { auth } from '@/app/lib/auth';
import { db } from '@db/server';
import { Badge } from '@gideon-defender/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gideon-defender/ui/breadcrumb';
import { Card, CardContent, CardFooter } from '@gideon-defender/ui/card';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PolicyAcceptButton } from './PolicyAcceptButton';
import PolicyViewer from './PolicyViewer';

function formatPolicyStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ policyId: string; orgId: string }>;
}) {
  const { policyId, orgId } = await params;
  const t = await getTranslations('policies');
  const tPage = await getTranslations('policyPage');

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect('/auth');
  }

  const policy = await db.policy.findUnique({
    where: { id: policyId, organizationId: orgId },
    include: {
      currentVersion: {
        select: {
          id: true,
          content: true,
          pdfUrl: true,
          version: true,
        },
      },
    },
  });

  if (!policy) {
    redirect(`/${orgId}`);
  }

  // Get the member info for the current org
  const member = await db.member.findFirst({
    where: activeMemberWhere({ userId: session.user.id, organizationId: orgId }),
  });

  if (!member) {
    redirect('/');
  }

  const isAccepted = policy.signedBy.includes(member.id);

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/${orgId}`}>{tPage('overviewBreadcrumb')}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{policy.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{policy.name}</h1>
          <Badge variant="secondary">{formatPolicyStatus(policy.status)}</Badge>
        </div>
        {policy.description && (
          <p className="text-sm text-muted-foreground">{policy.description}</p>
        )}
        {isAccepted && (
          <div className="rounded-md border border-border bg-muted px-4 py-4 sm:px-5 sm:py-4">
            <p className="text-sm font-medium">{t('acceptedBanner')}</p>
          </div>
        )}
        <Card>
          <CardContent className="pt-6">
            <div className="flex min-w-0 flex-col gap-4">
              <PolicyViewer policy={policy} />
              {policy.updatedAt && (
                <p className="text-sm text-muted-foreground">
                  {tPage('lastUpdated', { date: new Date(policy.updatedAt).toLocaleDateString() })}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <PolicyAcceptButton
              policyId={policy.id}
              memberId={member.id}
              isAccepted={isAccepted}
              orgId={orgId}
            />
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
