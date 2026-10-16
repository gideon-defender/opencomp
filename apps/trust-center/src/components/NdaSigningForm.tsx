'use client';

import { trustApi } from '@/lib/api';
import { isSafeHttpUrl } from '@/lib/urls';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileCheck, PenLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorClassName, inputClassName } from './formStyles';

const signNdaSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(100),
  email: z.email('Enter a valid email'),
  accept: z.boolean().refine((value) => value, 'You must accept the NDA to proceed'),
});

type SignNdaForm = z.infer<typeof signNdaSchema>;

/**
 * NDA signing form for emailed `/{friendlyUrl}/nda/{token}` links. Signs
 * through the shared trustApi helpers (name + email + accept) and
 * surfaces the grant portal URL from the sign response.
 */
export function NdaSigningForm({
  token,
  defaultName,
  defaultEmail,
}: {
  token: string;
  defaultName: string;
  defaultEmail: string;
}) {
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewUrls = useRef<Set<string> | null>(null);
  useEffect(() => {
    const urls = new Set<string>();
    previewUrls.current = urls;
    return () => {
      previewUrls.current = null;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignNdaForm>({
    resolver: zodResolver(signNdaSchema),
    defaultValues: { name: defaultName, email: defaultEmail, accept: false },
  });

  async function handleSign(data: SignNdaForm) {
    let portalUrl: string | null;
    try {
      const result = await trustApi.signNda(token, {
        name: data.name,
        email: data.email,
        accept: true,
      });
      const url = result?.portalUrl;
      portalUrl = typeof url === 'string' && isSafeHttpUrl(url) ? url : null;
    } catch (error) {
      // Helper errors carry server validation text verbatim; transport
      // failures keep the helper's generic prefix and map to friendly copy.
      const message = error instanceof Error ? error.message : '';
      toast.error(
        message && !message.startsWith('Trust API request failed')
          ? message
          : 'Could not sign the NDA — try again later',
      );
      return;
    }
    // The NDA is signed server-side at this point, so never report
    // success without a portal link — the user would have no way forward
    // except a blind retry that the server rejects as already-signed.
    if (!portalUrl) {
      toast.error('NDA signed but the portal link is missing — refresh the page');
      return;
    }
    setPortalUrl(portalUrl);
    toast.success('NDA signed');
  }

  async function handlePreview() {
    const opened = window.open('about:blank', '_blank');
    if (!opened) {
      toast.error('Popup blocked — allow popups to preview the NDA');
      return;
    }
    opened.opener = null;
    setPreviewing(true);
    try {
      const pdf = await trustApi.previewNda(token);
      if (!previewUrls.current) {
        opened.close();
        return;
      }
      const url = URL.createObjectURL(pdf);
      previewUrls.current.add(url);
      opened.location.href = url;
    } catch (error) {
      opened.close();
      const message = error instanceof Error ? error.message : '';
      toast.error(
        message && !message.startsWith('Trust API request failed')
          ? message
          : 'Could not preview the NDA',
      );
    } finally {
      setPreviewing(false);
    }
  }

  if (portalUrl) {
    return (
      <div className="rounded-lg border border-line bg-canvas p-6 text-center">
        <h2 className="text-lg font-semibold">NDA signed</h2>
        <p className="mt-1 text-sm text-muted">
          Your access portal is ready. Open it below — the link expires with your grant.
        </p>
        <a
          href={portalUrl}
          className="mt-4 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Open trust portal
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(handleSign)} noValidate className="space-y-4">
      <div>
        <label htmlFor="nda-name" className="mb-1 block text-[13px] font-semibold">
          Full name
        </label>
        <input
          id="nda-name"
          placeholder="Ada Lovelace"
          autoComplete="name"
          className={inputClassName}
          {...register('name')}
        />
        {errors.name && <p className={errorClassName}>{errors.name.message}</p>}
      </div>
      <div>
        <label htmlFor="nda-email" className="mb-1 block text-[13px] font-semibold">
          Work email
        </label>
        <input
          id="nda-email"
          placeholder="ada@company.com"
          type="email"
          autoComplete="email"
          className={inputClassName}
          {...register('email')}
        />
        {errors.email && <p className={errorClassName}>{errors.email.message}</p>}
        <p className="mt-1 text-[13px] text-muted">
          Must match the email the access was requested with.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <input id="nda-accept" type="checkbox" className="mt-1" {...register('accept')} />
        <label htmlFor="nda-accept" className="text-sm">
          I have read the NDA and agree to its terms.
        </label>
      </div>
      {errors.accept && <p className={errorClassName}>{errors.accept.message}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewing}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-line px-4 text-sm font-semibold transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileCheck size={16} aria-hidden="true" />
          {previewing ? 'Generating…' : 'Preview NDA'}
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PenLine size={16} aria-hidden="true" />
          {isSubmitting ? 'Signing…' : 'Sign NDA'}
        </button>
      </div>
    </form>
  );
}
