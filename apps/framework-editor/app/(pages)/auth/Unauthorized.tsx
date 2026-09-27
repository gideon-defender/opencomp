'use client';

import { authClient } from '@/app/lib/auth-client';
import { Button } from '@gideon-defender/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export const Unauthorized = () => {
  const router = useRouter();
  const t = useTranslations('auth');
  const tShell = useTranslations('shell');
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/auth');
        },
      },
    });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-center text-3xl font-bold">{t('unauthorizedTitle')}</h1>
        <p className="text-center">{t('unauthorizedDescription')}</p>
        <Button onClick={handleSignOut} disabled={loading}>
          {loading ? tShell('loading') : tShell('signOut')}
        </Button>
      </div>
    </div>
  );
};
