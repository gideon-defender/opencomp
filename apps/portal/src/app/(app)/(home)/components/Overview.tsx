import { activeMemberWhere } from '@/app/lib/active-member';
import { db } from '@db/server';
// Import types directly from @prisma/client
import type { Member, Organization, User } from '@db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
// Removed EmployeeTasksList import as it's not used directly here
import { NoAccessMessage } from './NoAccessMessage';
// Removed OrganizationSelector import
import { auth } from '@/app/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@gideon-defender/ui/card';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

// Define the type for the member prop including the user and organization relations
interface MemberWithUserOrg extends Member {
  user: User;
  organization: Organization;
}

// Removed OverviewProps interface and searchParams prop
// export async function Overview({ searchParams }: OverviewProps) {
export async function Overview() {
  const t = await getTranslations('overview');
  const tAccess = await getTranslations('access');
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect('/auth');
  }

  // Fetch all memberships for the user, including organization details
  const memberships = await db.member.findMany({
    where: activeMemberWhere({ userId: session.user.id }),
    include: {
      user: true,
      organization: true, // Include organization details
    },
  });

  // Case 1: No memberships found
  if (memberships.length === 0) {
    return <NoAccessMessage />;
  }

  // Filter memberships to only those with valid organization data
  const validMemberships = memberships.filter(
    (member): member is MemberWithUserOrg & { organization: Organization } =>
      Boolean(member.organization),
  );

  // If after filtering, there are no valid memberships with organizations
  if (validMemberships.length === 0) {
    // This case might indicate memberships exist but lack organization links
    console.warn('User has memberships but none with associated organizations.', {
      userId: session.user.id,
    });
    return <NoAccessMessage message={tAccess('noOrganizations')} />;
  }

  if (validMemberships.length === 1) {
    return redirect(`/${validMemberships[0].organization.id}`);
  }

  // Render a dashboard for each valid membership
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p className="font-medium">{t('yourOrganizations')}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {validMemberships.map((member) => (
          <Link href={`/${member.organization.id}`} key={member.id}>
            <Card>
              <CardHeader>
                <CardTitle>{member.organization.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p>{member.user.name}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
