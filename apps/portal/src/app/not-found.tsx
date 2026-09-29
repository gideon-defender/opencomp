import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <div className="text-muted-foreground flex h-dvh flex-col items-center justify-center text-center text-sm">
      <h2 className="mb-2 text-xl font-semibold">{t('notFoundTitle')}</h2>
      <p className="mb-4">{t('notFoundDescription')}</p>
      <Link href="/" className="underline">
        {t('returnHome')}
      </Link>
    </div>
  );
}
