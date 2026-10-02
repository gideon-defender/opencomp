'use client';

import { Icons } from '@gideon-defender/ui/icons';
import type { User } from 'better-auth';
import Link from 'next/link';
import { OnboardingUserMenu } from './OnboardingUserMenu';

interface MinimalHeaderProps {
  user: User;
  variant?: 'setup' | 'upgrade' | 'onboarding';
}

export function MinimalHeader({ user, variant = 'upgrade' }: MinimalHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-background flex items-center justify-between h-[90px] w-full px-4 md:px-18">
      <Link href="/" className="flex items-center gap-3">
        <Icons.Logo />
        <span className="text-lg font-medium">OpenComp</span>
      </Link>
      {(variant === 'onboarding' || variant === 'setup') && <OnboardingUserMenu user={user} />}
    </header>
  );
}
