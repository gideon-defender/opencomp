'use client';

import { completeInvitation } from '@/actions/organization/accept-invitation';
import { authClient } from '@/utils/auth-client';
import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import { Button } from '@gideon-defender/ui/button';
import { Loader2 } from 'lucide-react';
import { useAction } from 'next-safe-action/hooks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function AcceptInvite({
  inviteCode,
  organizationName,
}: {
  inviteCode: string;
  organizationName: string;
}) {
  const router = useRouter();
  const { execute, isPending } = useAction(completeInvitation, {
    onSuccess: async (result) => {
      if (result.data?.data?.organizationId) {
        const orgId = result.data.data.organizationId;
        try {
          // Set the active organization before redirecting
          await authClient.organization.setActive({
            organizationId: orgId,
          });
        } catch (error) {
          console.error('Failed to set active organization:', error);
          // Continue with redirect even if setActive fails
        }
        // Use router navigation to prevent React re-rendering the page
        // Server actions cause the parent Server Component to re-fetch data,
        // which would show "already accepted" before router.replace() executes
        router.push(`/${orgId}`);
      } else {
        // Fallback to home if no organizationId
        router.push('/');
      }
    },
    onError: (error) => {
      console.error('Accept invitation error:', error);
      toast.error('Failed to accept invitation');
    },
  });

  const handleAccept = async () => {
    await execute({ inviteCode });
  };

  return (
    <div className="bg-card relative w-full max-w-[440px] rounded-sm border p-8 shadow-lg">
      <div className="mb-8 flex justify-center">
        <Link href="/">
          <BrandLogo iconSize={40} />
        </Link>
      </div>

      <div className="mb-8 space-y-1.5 text-center">
        <h1 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          You have been invited to join
        </h1>
        <p className="text-2xl font-semibold tracking-tight line-clamp-1">
          {organizationName || 'an organization'}
        </p>
        <p className="text-muted-foreground text-sm">
          Please accept the invitation to join the organization.
        </p>
      </div>

      <Button onClick={handleAccept} className="w-full" size="sm" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Accepting...
          </>
        ) : (
          'Accept Invitation'
        )}
      </Button>
    </div>
  );
}
