import { Alert, AlertDescription, AlertTitle } from '@gideon-defender/ui/alert';
import { WarningAlt } from '@trycompai/design-system/icons';
import { getTranslations } from 'next-intl/server';

interface NoAccessMessageProps {
  message?: string;
}

export async function NoAccessMessage({ message }: NoAccessMessageProps) {
  const t = await getTranslations('access');
  return (
    <Alert variant="destructive" className="mx-auto max-w-md">
      <WarningAlt size={16} />
      <AlertTitle>{t('deniedTitle')}</AlertTitle>
      <AlertDescription>{message ?? t('defaultMessage')}</AlertDescription>
    </Alert>
  );
}
