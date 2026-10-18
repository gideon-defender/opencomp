import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import { TooltipProvider } from '@gideon-defender/ui/tooltip';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { SWRConfig } from 'swr';
import messages from '../../../apps/app/messages/en.json';
import { handlers } from '../src/mocks/handlers';
import { MockNavigationContext } from '../src/mocks/next/navigation';
import '../src/preview-styles.css';

initialize({
  onUnhandledRequest: 'bypass',
});

const navigation = {
  pathname: '/org_storybook/frameworks',
  searchParams: new URLSearchParams(),
  params: { orgId: 'org_storybook' },
  segments: ['frameworks'],
};

/**
 * Many containers (sheets, dialogs, tab panels) read their open state from the
 * URL via `useSearchParams()` or nuqs' `useQueryState()`. A story declares the
 * params it needs with `parameters.searchParams`; they are written to the real
 * location (nuqs reads `window.location`) and to the navigation mock context.
 */
function useStorySearchParams(raw: unknown): URLSearchParams {
  const entries = raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  const search = new URLSearchParams(entries);
  // nuqs resolves its initial value during render, so the location has to be
  // correct before the story mounts — not in an effect.
  const target = `${window.location.pathname}${search.size > 0 ? `?${search}` : ''}`;
  if (`${window.location.pathname}${window.location.search}` !== target) {
    window.history.replaceState(window.history.state, '', target);
  }
  return search;
}

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const searchParams = useStorySearchParams(context.parameters.searchParams);
      return (
        <MockNavigationContext.Provider value={{ ...navigation, searchParams }}>
          <NextIntlClientProvider
            locale="en"
            messages={messages}
            timeZone="UTC"
            now={new Date('2025-01-01T00:00:00Z')}
          >
            <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
              <NuqsAdapter>
                <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
                  <TooltipProvider>
                    <Story />
                    <Toaster richColors className="sb-preview-toaster" />
                  </TooltipProvider>
                </ThemeProvider>
              </NuqsAdapter>
            </SWRConfig>
          </NextIntlClientProvider>
        </MockNavigationContext.Provider>
      );
    },
  ],
  loaders: [mswLoader],
  parameters: {
    msw: { handlers },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
