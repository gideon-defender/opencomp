import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckrDetailsClient } from './CheckrDetailsClient';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

const screeningFallback = {
  data: [
    {
      id: 'run-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      status: 'invited',
      errorCode: null,
      createdAt: '2026-10-13T00:00:00.000Z',
    },
  ],
  count: 1,
};

function renderDetails(overrides: Partial<Parameters<typeof CheckrDetailsClient>[0]> = {}) {
  return render(
    <CheckrDetailsClient
      orgId="org-1"
      canStartScreening
      canReadScreenings
      initialScreenings={screeningFallback}
      initialReadiness={{ ready: true }}
      {...overrides}
    />,
  );
}

describe('CheckrDetailsClient', () => {
  it('renders all four sections', () => {
    renderDetails();

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Screenings')).toBeInTheDocument();
    expect(screen.getByText('Identity provisioning')).toBeInTheDocument();
    expect(screen.getByText('Configuration and health')).toBeInTheDocument();
  });

  it('marks provisioning as unavailable and IdP-owned', () => {
    renderDetails();

    expect(screen.getByText(/Provisioning status is unavailable in OpenComp/)).toBeInTheDocument();
    expect(screen.getByText(/Flagged results never create identities/)).toBeInTheDocument();
  });

  it('shows the start action and candidates link when permitted', () => {
    renderDetails();

    expect(screen.getByRole('button', { name: 'Start background check' })).toBeInTheDocument();
    const candidates = screen.getByRole('link', { name: /View candidates/ });
    expect(candidates).toHaveAttribute('href', '/org-1/people?tab=candidates');
  });

  it('hides screening actions without permission', () => {
    renderDetails({ canStartScreening: false, canReadScreenings: false });

    expect(
      screen.queryByRole('button', { name: 'Start background check' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/background check read permission/)).toBeInTheDocument();
    expect(screen.getByText(/background check permission/)).toBeInTheDocument();
  });

  it('lists screening attempts from fallback data without inferring identity results', () => {
    renderDetails();

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Checkr invitation sent')).toBeInTheDocument();
    expect(
      screen.getByText(/Invitation sent is not a clear report or an identity result/),
    ).toBeInTheDocument();
  });

  it('shows setup guidance when intake is not ready', () => {
    renderDetails({ initialReadiness: { ready: false, message: 'Configure the tenant.' } });

    expect(screen.getByText('Setup required')).toBeInTheDocument();
    expect(screen.getByText('Configure the tenant.')).toBeInTheDocument();
  });

  it('shows unavailable status instead of permission text when readiness fetch fails', () => {
    renderDetails({ initialReadiness: undefined });

    expect(screen.getByText(/Configuration status is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Configuration details require/)).not.toBeInTheDocument();
  });

  it('gates start and read permissions independently (can start, cannot read)', () => {
    renderDetails({ canReadScreenings: false });

    expect(screen.getByRole('button', { name: 'Start background check' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View candidates/ })).not.toBeInTheDocument();
    expect(screen.getByText(/background check read permission/)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('gates start and read permissions independently (can read, cannot start)', () => {
    renderDetails({ canStartScreening: false });

    expect(
      screen.queryByRole('button', { name: 'Start background check' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View candidates/ })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/Configuration details require/)).toBeInTheDocument();
  });
});
