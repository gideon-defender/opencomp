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
    render(<CheckrCatalogCard orgId="org-1" readinessStatus="loaded" canReadStatus={false} />);

    expect(screen.getByText('Checkr')).toBeInTheDocument();
    expect(
      screen.getByText('Background checks and candidate identity provisioning'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Checkr/ });
    expect(link).toHaveAttribute('href', '/org-1/integrations/checkr');
    expect(screen.getByText('View details')).toBeInTheDocument();
  });

  it('shows Restricted when status is not readable', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: true }}
        readinessStatus="loaded"
        canReadStatus={false}
      />,
    );

    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  it('shows a loading placeholder instead of a status badge while readiness loads', () => {
    render(<CheckrCatalogCard orgId="org-1" readinessStatus="loading" canReadStatus />);

    expect(screen.getByRole('status', { name: 'Checking Checkr status' })).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Restricted')).not.toBeInTheDocument();
  });

  it('shows Unavailable when the readiness fetch fails', () => {
    render(<CheckrCatalogCard orgId="org-1" readinessStatus="error" canReadStatus />);

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
  });

  it('ignores stale readiness data when the fetch fails', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: true }}
        readinessStatus="error"
        canReadStatus
      />,
    );

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });

  it('shows Ready when intake is ready', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: true }}
        readinessStatus="loaded"
        canReadStatus
      />,
    );

    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('shows Setup required when intake is not ready', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: false, message: 'Configure the tenant account.' }}
        readinessStatus="loaded"
        canReadStatus
      />,
    );

    expect(screen.getByText('Setup required')).toBeInTheDocument();
  });

  it('surfaces the readiness message on the card when intake is not ready', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: false, message: 'Configure the tenant account.' }}
        readinessStatus="loaded"
        canReadStatus
      />,
    );

    expect(screen.getByText('Configure the tenant account.')).toBeInTheDocument();
  });

  it('hides the readiness message when intake is ready', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={{ ready: true, message: 'Configure the tenant account.' }}
        readinessStatus="loaded"
        canReadStatus
      />,
    );

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText('Configure the tenant account.')).not.toBeInTheDocument();
  });

  it('shows Not configured when readiness is unavailable', () => {
    render(
      <CheckrCatalogCard
        orgId="org-1"
        readiness={undefined}
        readinessStatus="loaded"
        canReadStatus
      />,
    );

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Setup required')).not.toBeInTheDocument();
  });
});
