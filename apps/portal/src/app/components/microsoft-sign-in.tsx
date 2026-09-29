'use client';

import { buildSignInCallbackUrls } from '@/app/lib/auth-callback';
import { authClient } from '@/app/lib/auth-client';
import { Button } from '@gideon-defender/ui/button';
import { Icons } from '@gideon-defender/ui/icons';
import { Spinner } from '@trycompai/design-system';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

export function MicrosoftSignIn({
  inviteCode,
  searchParams,
}: {
  inviteCode?: string;
  searchParams?: URLSearchParams;
}) {
  const [isLoading, setLoading] = useState(false);
  const t = useTranslations('auth');

  const handleSignIn = async () => {
    setLoading(true);

    try {
      const { callbackURL, errorCallbackURL } = buildSignInCallbackUrls({
        origin: window.location.origin,
        inviteCode,
        searchParams,
      });

      await authClient.signIn.social({
        provider: 'microsoft',
        callbackURL,
        // Without this, an OAuth callback error redirects to the API root
        // (Swagger docs) instead of back to the portal. See CS-760.
        errorCallbackURL,
      });
    } catch (error) {
      setLoading(false);

      console.error('[Microsoft Sign-In] Authentication failed:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });

      // Show specific error messages based on error type
      if (error instanceof Error) {
        if (error.message.includes('redirect_uri_mismatch')) {
          toast.error(t('microsoftConfigError'), {
            description: t('microsoftRedirectMismatch'),
          });
        } else if (error.message.includes('invalid_client')) {
          toast.error(t('microsoftInvalidClient'), {
            description: t('microsoftInvalidClientDesc'),
          });
        } else if (error.message.includes('account_not_linked')) {
          toast.error(t('microsoftLinkFailed'), {
            description: t('microsoftLinkFailedDesc'),
          });
          console.warn(
            '[Microsoft Sign-In] account_not_linked error occurred despite auto-linking being enabled. Check account linking configuration.',
          );
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
          toast.error(t('microsoftNetworkError'), {
            description: t('microsoftNetworkErrorDesc'),
          });
        } else {
          toast.error(t('microsoftSignInFailed'), {
            description: error.message || t('microsoftSignInFailedDesc'),
          });
        }
      } else {
        toast.error(t('microsoftSignInFailedGeneric'), {
          description: t('unexpectedError'),
        });
      }
    }
  };

  return (
    <Button
      onClick={handleSignIn}
      className="w-full h-11 font-medium"
      variant="outline"
      disabled={isLoading}
    >
      {isLoading ? (
        <Spinner size="sm" />
      ) : (
        <>
          <Icons.Microsoft className="h-4 w-4" />
          {t('continueWithMicrosoft')}
        </>
      )}
    </Button>
  );
}
