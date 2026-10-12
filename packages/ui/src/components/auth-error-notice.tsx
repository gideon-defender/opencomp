import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';

/**
 * Pre-session login failure notice for `/auth?error=<code>` (an IdP deny
 * lands with `no_role`; legacy `gideon_*` failures never had messaging).
 * Presentational only: the page translates the code and passes strings in,
 * so this renders without next-intl and stays unit-testable.
 */
export function AuthErrorNotice({ title, description }: { title: string; description: string }) {
  return (
    <Alert variant="destructive" data-testid="auth-error-notice">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
