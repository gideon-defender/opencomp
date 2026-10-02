import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrganizationBadge } from './organization-badge';

describe('OrganizationBadge', () => {
  it('renders logo and company name without any switcher control', () => {
    render(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/logo.png"
      />,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByAltText('Acme Corp logo')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders initials fallback when no logo is provided', () => {
    render(<OrganizationBadge organization={{ id: 'org_1', name: 'Acme Corp' }} />);

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
  });

  it('renders only the logo mark when collapsed', () => {
    render(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/logo.png"
        isCollapsed
      />,
    );

    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
    expect(screen.getByAltText('Acme Corp logo')).toBeInTheDocument();
  });

  it('renders nothing when organization is null', () => {
    const { container } = render(<OrganizationBadge organization={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('applies maxWidth to the truncated name', () => {
    render(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/logo.png"
        maxWidth="200px"
      />,
    );

    expect(screen.getByText('Acme Corp')).toHaveStyle({ maxWidth: '200px' });
  });

  it('renders initials fallback when collapsed without a logo', () => {
    render(<OrganizationBadge organization={{ id: 'org_1', name: 'Acme Corp' }} isCollapsed />);

    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();
  });

  it('derives initials from a single-word name', () => {
    render(<OrganizationBadge organization={{ id: 'org_1', name: 'Madonna' }} />);

    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('caps initials at two words for long names', () => {
    render(<OrganizationBadge organization={{ id: 'org_1', name: 'John Ronald Reuel' }} />);

    expect(screen.getByText('JR')).toBeInTheDocument();
  });

  it('renders a placeholder for a blank name', () => {
    render(<OrganizationBadge organization={{ id: 'org_1', name: '   ' }} />);

    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('falls back to initials when the logo image fails to load', () => {
    render(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/expired-logo.png"
      />,
    );

    fireEvent.error(screen.getByAltText('Acme Corp logo'));

    expect(screen.queryByAltText('Acme Corp logo')).not.toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('shows the logo again when logoUrl changes after a load failure', () => {
    const { rerender } = render(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/expired-logo.png"
      />,
    );

    fireEvent.error(screen.getByAltText('Acme Corp logo'));
    expect(screen.getByText('AC')).toBeInTheDocument();

    rerender(
      <OrganizationBadge
        organization={{ id: 'org_1', name: 'Acme Corp' }}
        logoUrl="https://example.com/fresh-logo.png"
      />,
    );

    expect(screen.getByAltText('Acme Corp logo')).toBeInTheDocument();
    expect(screen.queryByText('AC')).not.toBeInTheDocument();
  });
});
