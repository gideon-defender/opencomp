'use client';

import { authClient } from '@/app/lib/auth-client';
import { Button } from '@gideon-defender/ui/button';
import { cn } from '@gideon-defender/ui/cn';
import { Form, FormControl, FormField, FormItem } from '@gideon-defender/ui/form';
import { Input } from '@gideon-defender/ui/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Spinner } from '@trycompai/design-system';
import { ArrowRight } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { OtpForm } from './otp-form';

type Props = {
  className?: string;
  deviceAuthRedirect?: string;
};

export function OtpSignIn({ className, deviceAuthRedirect }: Props) {
  const [isLoading, setLoading] = useState(false);
  const [isSent, setSent] = useState(false);
  const [_email, setEmail] = useState<string>();
  const t = useTranslations('auth');
  const tValidation = useTranslations('validation');

  const formSchema = z.object({
    email: z.string().email(tValidation('emailInvalid')),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
    },
  });

  async function handleSubmit({ email }: z.infer<typeof formSchema>) {
    setLoading(true);
    setEmail(email);

    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: email,
      type: 'sign-in',
    });

    if (error) {
      setLoading(false);
      // Never surface the raw server message: it is English-only and may
      // carry internal details. The sibling OtpForm maps failures to the
      // same dictionary key.
      toast.error(t('unexpectedError'));
      setSent(false);
    } else {
      setSent(true);
    }

    setLoading(false);
  }

  if (isSent) {
    return (
      <div className={cn('flex flex-col space-y-4', className)}>
        <OtpForm email={_email ?? ''} deviceAuthRedirect={deviceAuthRedirect} />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <div className={cn('flex flex-col space-y-4', className)}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    placeholder={t('workEmailPlaceholder')}
                    {...field}
                    autoFocus
                    className="h-[40px]"
                    autoCapitalize="false"
                    autoCorrect="false"
                    spellCheck="false"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="flex h-[40px] w-full space-x-2 px-6 py-4 font-medium active:scale-[0.98]"
            disabled={isLoading}
          >
            {isLoading ? (
              <Spinner size="sm" />
            ) : (
              <>
                <span>{t('continue')}</span>
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
