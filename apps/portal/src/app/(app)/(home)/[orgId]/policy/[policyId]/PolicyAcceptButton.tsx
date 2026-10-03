'use client';

import { Button } from '@trycompai/design-system';
import { Checkmark } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

interface PolicyAcceptButtonProps {
  policyId: string;
  memberId: string;
  isAccepted: boolean;
  orgId: string;
}

export function PolicyAcceptButton({
  policyId,
  memberId,
  isAccepted,
  orgId,
}: PolicyAcceptButtonProps) {
  const router = useRouter();
  const t = useTranslations('policies');
  const [isPending, startTransition] = useTransition();
  const [accepted, setAccepted] = useState(isAccepted);

  const handleAccept = async () => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/portal/accept-policies', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ policyIds: [policyId], memberId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t('acceptFailed'));
        }

        setAccepted(true);
        toast.success(t('policyAcceptedToast'));
        router.refresh();
        // Redirect after a short delay to show the success state
        setTimeout(() => {
          router.push(`/${orgId}`);
        }, 1000);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('acceptErrorGeneric'));
      }
    });
  };

  if (accepted) {
    return (
      <div className="w-full">
        <Button disabled iconLeft={<Checkmark size={16} />}>
          {t('policyAcceptedBtn')}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button onClick={handleAccept} disabled={isPending}>
        {isPending ? t('acceptingPolicy') : t('acceptPolicy')}
      </Button>
    </div>
  );
}
