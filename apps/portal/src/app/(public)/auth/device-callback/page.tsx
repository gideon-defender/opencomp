'use client';

import { BrandLogo } from '@gideon-defender/ui/brand-logo';
import { Card, CardContent, CardHeader, CardTitle } from '@gideon-defender/ui/card';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Status = 'redirecting' | 'success' | 'error';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export default function DeviceCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>('redirecting');
  const [errorMessage, setErrorMessage] = useState('');
  const t = useTranslations('auth');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const callbackPort = searchParams.get('callback_port');
      const state = searchParams.get('state');

      if (!callbackPort || !state) {
        // Validation runs synchronously, so defer the state update out of
        // the effect body. Flushes before paint, same as the direct call.
        queueMicrotask(() => {
          if (cancelled) return;
          setStatus('error');
          setErrorMessage(t('deviceMissingParams'));
        });
        return;
      }

      const port = Number.parseInt(callbackPort, 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        queueMicrotask(() => {
          if (cancelled) return;
          setStatus('error');
          setErrorMessage(t('deviceInvalidPort'));
        });
        return;
      }

      try {
        // Generate an auth code by calling the NestJS API cross-origin
        const response = await fetch(`${apiUrl}/v1/device-agent/auth-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ callback_port: port, state }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || data.message || `Server returned ${response.status}`);
        }

        const { code } = await response.json();

        // Redirect to the device agent's localhost server
        window.location.href = `http://localhost:${port}/auth-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state!)}`;

        setStatus('success');
      } catch (err) {
        console.error('Device auth callback failed:', err);
        if (cancelled) return;
        setStatus('error');
        // Never render the raw error: it is English-only and may contain
        // server internals (status codes, API error bodies). The detail
        // stays in the console above for debugging.
        setErrorMessage(t('deviceExchangeFailed'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, t]);

  return (
    <div className="flex min-h-dvh flex-col text-foreground">
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3 pt-10">
            <div className="mx-auto">
              <BrandLogo iconSize={40} />
            </div>
            <CardTitle className="text-xl tracking-tight text-card-foreground">
              {status === 'redirecting' && t('deviceCompleting')}
              {status === 'success' && t('deviceSuccess')}
              {status === 'error' && t('deviceFailed')}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center pb-10">
            {status === 'redirecting' && (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('deviceRedirecting')}</p>
              </div>
            )}
            {status === 'success' && (
              <div className="flex flex-col items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <p className="text-sm text-muted-foreground">{t('deviceCloseTab')}</p>
              </div>
            )}
            {status === 'error' && <p className="text-sm text-destructive">{errorMessage}</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
