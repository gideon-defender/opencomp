import { Header } from '@/components/header';
import { OrganizationBadge } from '@/components/organization-badge';
import { SignOut } from '@/components/sign-out';
import { serverApi } from '@/lib/api-server';
import { auth } from '@/utils/auth';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function NoAccess() {
  const t = await getTranslations('errors');
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session || !session.session.activeOrganizationId) {
    return redirect('/');
  }

  const orgRes = await serverApi.get<{ id: string; name: string }>('/v1/organization');

  const currentOrg = orgRes.data ?? null;

  return (
    <div className="flex h-dvh flex-col">
      <Header organization={currentOrg} organizationId={currentOrg?.id} hideChat={true} />
      <div className="bg-foreground/05 flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">{t('accessDeniedTitle')}</h1>
        <div className="flex flex-col text-center">
          <p>
            {t.rich('accessDeniedDescription', {
              portal: (chunk) => (
                <Link href="https://portal.gideondefender.com" className="text-primary underline">
                  {chunk}
                </Link>
              ),
            })}
          </p>
        </div>
        {currentOrg ? (
          <div>
            <OrganizationBadge organization={currentOrg} />
          </div>
        ) : null}
        <div>
          <SignOut asButton />
        </div>
      </div>
    </div>
  );
}
