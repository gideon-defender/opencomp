'use client';

import { authClient } from '@/app/lib/auth-client';
import { DropdownMenuItem } from '@gideon-defender/ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function Logout() {
  const [isLoading, setLoading] = useState(false);
  const router = useRouter();
  const t = useTranslations('auth');

  const handleLogout = async () => {
    setLoading(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/auth'); // Redirect to /auth instead of /login
        },
      },
    });
    setLoading(false);
  };

  return (
    <DropdownMenuItem onClick={handleLogout}>
      {isLoading ? t('signingOut') : t('signOut')}
    </DropdownMenuItem>
  );
}
