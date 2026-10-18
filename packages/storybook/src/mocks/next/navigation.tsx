/**
 * Browser-safe stand-in for `next/navigation`.
 *
 * Storybook runs on `@storybook/react-vite` (the Next.js adapter does not
 * support Next 16 yet), so the real module throws because no Next router is
 * mounted. Every hook returns inert values and every navigation call is logged.
 */
import { createContext, useContext } from 'react';

export type MockRouterState = {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string | string[]>;
  segments: string[];
};

const DEFAULT_STATE: MockRouterState = {
  pathname: '/org_storybook/frameworks',
  searchParams: new URLSearchParams(),
  params: { orgId: 'org_storybook' },
  segments: [],
};

export const MockNavigationContext = createContext<MockRouterState>(DEFAULT_STATE);

function log(action: string, ...args: unknown[]) {
  console.info(`[storybook] router.${action}`, ...args);
}

const router = {
  push: (href: string) => log('push', href),
  replace: (href: string) => log('replace', href),
  refresh: () => log('refresh'),
  back: () => log('back'),
  forward: () => log('forward'),
  prefetch: (href: string) => log('prefetch', href),
};

export type AppRouterInstance = typeof router;

export function useRouter(): AppRouterInstance {
  return router;
}

export function usePathname(): string {
  return useContext(MockNavigationContext).pathname;
}

export function useSearchParams(): URLSearchParams {
  return useContext(MockNavigationContext).searchParams;
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): T {
  return useContext(MockNavigationContext).params as T;
}

export function useSelectedLayoutSegment(): string | null {
  return useContext(MockNavigationContext).segments[0] ?? null;
}

export function useSelectedLayoutSegments(): string[] {
  return useContext(MockNavigationContext).segments;
}

export function useServerInsertedHTML(): void {}

export function redirect(href: string): never {
  log('redirect', href);
  throw new Error(`[storybook] redirect(${href}) was called outside a Next.js server context`);
}

export const permanentRedirect = redirect;

export function notFound(): never {
  throw new Error('[storybook] notFound() was called');
}

export function forbidden(): never {
  throw new Error('[storybook] forbidden() was called');
}

export function unauthorized(): never {
  throw new Error('[storybook] unauthorized() was called');
}

export enum RedirectType {
  push = 'push',
  replace = 'replace',
}

export const ReadonlyURLSearchParams = URLSearchParams;
