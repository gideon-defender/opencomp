'use client';

import { Button } from '@gideon-defender/ui/button';
import { DropdownMenuItem } from '@gideon-defender/ui/dropdown-menu';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '../lib/auth-client';

export function SignOut({ asButton = false }: { asButton?: boolean }) {
  const router = useRouter();
  const t = useTranslations('shell');
  const [isLoading, setLoading] = useState(false);

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

  const label = isLoading ? t('loading') : t('signOut');

  if (asButton) {
    return <Button onClick={handleSignOut}>{label}</Button>;
  }

  return <DropdownMenuItem onClick={handleSignOut}>{label}</DropdownMenuItem>;
}
