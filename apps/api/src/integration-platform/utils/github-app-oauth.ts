import { z } from 'zod';

export const githubAppSlug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function githubAppInstallUrl({
  customSettings,
  fallback,
}: {
  customSettings?: Record<string, unknown>;
  fallback?: string;
}): string | undefined {
  if (customSettings?.githubAppSlug === undefined) return fallback;
  const slug = githubAppSlug.parse(customSettings.githubAppSlug);
  return `https://github.com/apps/${slug}/installations/new`;
}
