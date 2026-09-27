import { Skeleton } from '@gideon-defender/ui/skeleton';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense } from 'react';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export async function Header() {
  const t = await getTranslations('shell');

  return (
    <header className="bg-card border-border/40 sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3">
      <Link
        href="/frameworks"
        className="text-foreground hover:text-foreground/80 text-sm font-semibold tracking-tight"
      >
        {t('appTitle')}
      </Link>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
        <Suspense fallback={<Skeleton className="h-8 w-8 rounded-full" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
