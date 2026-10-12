import { activeMemberWhere } from '@/app/lib/active-member';
import { auth } from '@/app/lib/auth';
import { db } from '@db/server';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@gideon-defender/ui/breadcrumb';
import { Card, CardContent } from '@gideon-defender/ui/card';
import { FileText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sortPoliciesByName } from '../components/policy/sort-policies-by-name';

export default async function SignedPoliciesPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const t = await getTranslations('policies');

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect('/auth');
  }

  const member = await db.member.findFirst({
    where: activeMemberWhere({ userId: session.user.id, organizationId: orgId }),
  });

  if (!member) {
    redirect('/');
  }

  const policies = sortPoliciesByName(
    await db.policy.findMany({
      where: {
        organizationId: orgId,
        status: 'published',
        isRequiredToSign: true,
        isArchived: false,
        archivedAt: null,
        signedBy: { has: member.id },
      },
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    }),
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/${orgId}`}>{t('overviewBreadcrumb')}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t('signedPolicies')}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t('signedPolicies')}</h1>
        {policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noSignedPolicies')}</p>
        ) : (
          <div className="space-y-2">
            {policies.map((policy) => (
              <Link key={policy.id} href={`/${orgId}/policy/${policy.id}`} className="block">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="text-muted-foreground">
                        <FileText size={20} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{policy.name}</p>
                        {policy.description && (
                          <p className="text-sm text-muted-foreground">{policy.description}</p>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {new Date(policy.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
