/**
 * Page footer: dark inverted block with the linked wordmark.
 */
export function TrustFooter() {
  return (
    <footer className="mt-16 bg-foot py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-2 px-4 md:px-6">
        <p className="inline-flex items-center gap-1.5 text-sm text-foot-ink">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 1.5 14.5 5v6L8 14.5 1.5 11V5L8 1.5Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M5.5 8l1.8 1.8L10.8 6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Powered by{' '}
          <a
            href="https://github.com/gideon-defender/opencomp"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white underline-offset-2 hover:underline"
          >
            OpenComp
          </a>
        </p>
      </div>
    </footer>
  );
}
