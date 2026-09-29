import Link from 'next/link';

export default function TrustCenterHome() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 text-center">
        <div
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-xl font-bold text-white"
        >
          T
        </div>
        <h1 className="mt-4 text-xl font-bold">Trust Center</h1>
        <p className="mt-2 text-sm text-muted">
          Open a published trust portal at{' '}
          <code className="rounded bg-canvas px-1 text-xs">/{`{organization}`}</code>, or follow an
          access link you received by email.
        </p>
        <Link
          href="https://gideondefender.com"
          className="mt-6 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary"
        >
          Learn more
        </Link>
      </div>
    </div>
  );
}
