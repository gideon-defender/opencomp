/**
 * Re-export of the shared URL safety helpers.
 * Single implementation lives in `@gideon-defender/utils` (safe-url.ts)
 * so the API, catalog service, and frontend share one rule.
 */
export { isSafeHttpUrl, toSafeExternalHref } from '@gideon-defender/utils';
