import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('@/hooks/use-trust-portal-settings', () => ({
  useTrustPortalSettings: () => ({
    updateVendorTrustSettings: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock design system
vi.mock('@trycompai/design-system', () => ({
  Button: ({ children, onClick, disabled, iconLeft, iconRight, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  ),
  Switch: ({ checked, disabled, onCheckedChange }: any) => (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock('@trycompai/design-system/icons', () => ({
  ChevronLeft: () => <span />,
  ChevronRight: () => <span />,
}));

vi.mock('./logos', () => ({
  DORA: () => <span />,
  GDPR: () => <span />,
  HIPAA: () => <span />,
  HITRUST: () => <span />,
  ISO27001: () => <span />,
  ISO42001: () => <span />,
  ISO9001: () => <span />,
  NEN7510: () => <span />,
  NIS2: () => <span />,
  NIST80053: () => <span />,
  NISTCSF: () => <span />,
  PCIDSS: () => <span />,
  SOC2Type2: () => <span />,
}));

import { TrustPortalVendors } from './TrustPortalVendors';

const mockVendors = [
  {
    id: 'vendor-1',
    name: 'AWS',
    description: 'Cloud provider',
    website: 'https://aws.amazon.com',
    showOnTrustPortal: true,
    logoUrl: null,
    complianceBadges: [{ type: 'soc2' as const, verified: true }],
  },
  {
    id: 'vendor-2',
    name: 'Datadog',
    description: 'Monitoring',
    website: 'https://datadoghq.com',
    showOnTrustPortal: false,
    logoUrl: null,
    complianceBadges: null,
  },
];

describe('TrustPortalVendors permission gating', () => {
  const defaultProps = {
    initialVendors: mockVendors,
    orgId: 'org-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders section title regardless of permissions', () => {
    setMockPermissions({});
    render(<TrustPortalVendors {...defaultProps} />);
    expect(screen.getByText('Vendors')).toBeInTheDocument();
    expect(
      screen.getByText('Configure which vendors appear on your public trust portal'),
    ).toBeInTheDocument();
  });

  it('renders vendor names regardless of permissions', () => {
    setMockPermissions({});
    render(<TrustPortalVendors {...defaultProps} />);
    expect(screen.getByText('AWS')).toBeInTheDocument();
    expect(screen.getByText('Datadog')).toBeInTheDocument();
  });

  it('enables visibility switches when user has trust:update permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<TrustPortalVendors {...defaultProps} />);
    const switches = screen.getAllByRole('switch');
    for (const sw of switches) {
      expect(sw).not.toBeDisabled();
    }
  });

  it('disables visibility switches when user lacks trust:update permission', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<TrustPortalVendors {...defaultProps} />);
    const switches = screen.getAllByRole('switch');
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
  });

  it('disables visibility switches when user has no permissions', () => {
    setMockPermissions({});
    render(<TrustPortalVendors {...defaultProps} />);
    const switches = screen.getAllByRole('switch');
    for (const sw of switches) {
      expect(sw).toBeDisabled();
    }
  });

  it('renders empty state when no vendors exist', () => {
    setMockPermissions({});
    render(<TrustPortalVendors initialVendors={[]} orgId="org-1" />);
    expect(screen.getByText(/no vendors found/i)).toBeInTheDocument();
  });
});

describe('TrustPortalVendors vendor logos', () => {
  const logoVendors = [
    {
      id: 'vendor-gh',
      name: 'GitHub',
      description: 'Code hosting',
      website: 'https://github.com',
      showOnTrustPortal: true,
      logoUrl: null,
      complianceBadges: [],
    },
    {
      id: 'vendor-google',
      name: 'Google',
      description: 'Cloud',
      website: 'https://cloud.google.com',
      showOnTrustPortal: true,
      logoUrl: null,
      complianceBadges: [],
    },
    {
      id: 'vendor-stored-favicon',
      name: 'Stored Favicon',
      description: 'Previously synced low-res favicon',
      website: 'https://github.com',
      showOnTrustPortal: true,
      logoUrl: 'https://www.google.com/s2/favicons?domain=github.com&sz=128',
      complianceBadges: [],
    },
    {
      id: 'vendor-manual',
      name: 'Manual Logo',
      description: 'Manually uploaded logo',
      website: 'https://github.com',
      showOnTrustPortal: true,
      logoUrl: 'https://example.com/custom-logo.png',
      complianceBadges: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses high-res assets for known-bad favicon domains', () => {
    setMockPermissions({});
    render(<TrustPortalVendors initialVendors={logoVendors} orgId="org-1" />);
    expect(screen.getByAltText('GitHub logo')).toHaveAttribute(
      'src',
      'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    );
    // Subdomains resolve through the registrable domain.
    expect(screen.getByAltText('Google logo')).toHaveAttribute(
      'src',
      'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png',
    );
  });

  it('upgrades stored Google favicon URLs but leaves manual uploads alone', () => {
    setMockPermissions({});
    render(<TrustPortalVendors initialVendors={logoVendors} orgId="org-1" />);
    expect(screen.getByAltText('Stored Favicon logo')).toHaveAttribute(
      'src',
      'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    );
    expect(screen.getByAltText('Manual Logo logo')).toHaveAttribute(
      'src',
      'https://example.com/custom-logo.png',
    );
  });
});
