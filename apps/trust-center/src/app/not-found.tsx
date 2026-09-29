import Link from 'next/link';

export default function TrustCenterNotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold">Trust Center not found</h1>
        <p className="mt-2 text-sm text-muted">
          This trust portal does not exist or is no longer published. Check the link and try again.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-medium hover:bg-canvas"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
