import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthErrorNotice } from './auth-error-notice';

describe('AuthErrorNotice', () => {
  it('renders the translated title and description', () => {
    const html = renderToStaticMarkup(
      <AuthErrorNotice title="No access" description="Ask your admin." />,
    );

    expect(html).toContain('data-testid="auth-error-notice"');
    expect(html).toContain('No access');
    expect(html).toContain('Ask your admin.');
  });

  it('exposes an alert role for assistive tech', () => {
    const html = renderToStaticMarkup(<AuthErrorNotice title="t" description="d" />);

    expect(html).toContain('role="alert"');
  });
});
