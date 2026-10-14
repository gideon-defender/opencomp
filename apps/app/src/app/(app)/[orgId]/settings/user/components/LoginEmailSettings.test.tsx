import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoginEmailSettings } from './LoginEmailSettings';

const CURRENT_EMAIL = 'admin@old-domain.com';

describe('LoginEmailSettings', () => {
  it('shows the current login email', () => {
    render(<LoginEmailSettings currentEmail={CURRENT_EMAIL} />);
    expect(screen.getByText(`You currently sign in as ${CURRENT_EMAIL}.`)).toBeInTheDocument();
  });

  it('explains the email is managed by the identity provider', () => {
    render(<LoginEmailSettings currentEmail={CURRENT_EMAIL} />);
    expect(screen.getByText(/managed by Gideon/)).toBeInTheDocument();
  });

  it('offers no self-service change form while changeEmail is disabled', () => {
    render(<LoginEmailSettings currentEmail={CURRENT_EMAIL} />);
    expect(screen.queryByLabelText('New email address')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
