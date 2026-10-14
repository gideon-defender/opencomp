import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckrCatalogCard } from './CheckrCatalogCard';

// Mock next/image
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- test mock for next/image intentionally renders img passthrough
  default: (props: any) => <img {...props} />,
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

describe('CheckrCatalogCard', () => {
  it('links to the org-scoped Checkr details route', () => {
    render(<CheckrCatalogCard orgId="org-1" canReadStatus={false} />);

    expect(screen.getByText('Checkr')).toBeInTheDocument();
    expect(
      screen.getByText('Background checks and candidate identity provisioning'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Checkr/ });
    expect(link).toHaveAttribute('href', '/org-1/integrations/checkr');
    expect(screen.getByText('View details')).toBeInTheDocument();
  });

  it('shows no status badge when status is not readable', () => {
    render(<CheckrCatalogCard orgId="org-1" readiness={{ ready: true }} canReadStatus={false} />);

    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
  });

  it('shows Ready when intake is ready', () => {
    render(<CheckrCatalogCard orgId="org-1" readiness={{ ready: true }} canReadStatus />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('shows Setup required when intake is not ready', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: false, message: 'Configure the tenant account.' }}
        canReadStatus
      />,
    );

    expect(screen.getByText('Setup required')).toBeInTheDocument();
  });

  it('shows no status badge when readiness is unavailable', () => {
    render(<CheckrCatalogCard orgId="org-1" readiness={undefined} canReadStatus />);

    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
  });
});
