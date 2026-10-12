import { mockNextIntl } from '@/test-utils/mocks/next-intl';
import { mockHasPermission, setMockPermissions } from '@/test-utils/mocks/permissions';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

mockNextIntl();

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasPermission: mockHasPermission }),
}));

const mockUseApiSWR = vi.fn();
vi.mock('@/hooks/use-api-swr', () => ({
  useApiSWR: () => mockUseApiSWR(),
}));

const mockUseFrameworkUpdateStatuses = vi.fn();
vi.mock('@/hooks/use-framework-update-statuses', () => ({
  useFrameworkUpdateStatuses: () => mockUseFrameworkUpdateStatuses(),
}));

vi.mock('../components/FrameworkUpdatesCard', () => ({
  FrameworkUpdatesCard: () => <div>framework updates available</div>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: 'org_123' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@trycompai/design-system', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div data-testid="alert">{children}</div>,
  AlertAction: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@trycompai/design-system/icons', () => ({
  Close: () => <span>x</span>,
  WarningAlt: () => <span>!</span>,
  ChevronDown: () => <span>v</span>,
  ChevronUp: () => <span>^</span>,
  ArrowRight: () => <span>→</span>,
}));

import { OverviewNudges } from './OverviewNudges';

// Mock localStorage for jsdom (same pattern as the trust-settings tests).
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const TRUST_PERMS = { trust: ['read', 'update'] };

function setOffboarding(members: { memberId: string; name: string }[]) {
  mockUseApiSWR.mockReturnValue({ data: { data: { members } }, error: undefined });
}

function setFrameworkUpdates(items: { frameworkInstanceId: string }[]) {
  mockUseFrameworkUpdateStatuses.mockReturnValue({ data: items, error: undefined });
}

describe('OverviewNudges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setOffboarding([]); // default: no offboarding
    setFrameworkUpdates([]); // default: no framework updates
    setMockPermissions(TRUST_PERMS);
  });

  const server = (over?: Partial<{ isConfigured: boolean }>) => ({
    trust: { isConfigured: false, ...over },
  });

  it('shows the trust nudge without a feature flag when not configured and user can update', () => {
    render(<OverviewNudges orgId="org_123" server={server()} />);
    expect(screen.getByText('nudges.trustSetupTitle')).toBeInTheDocument();
  });

  it('hides the trust nudge when already configured', () => {
    render(<OverviewNudges orgId="org_123" server={server({ isConfigured: true })} />);
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
  });

  it('hides the trust nudge without trust:update', () => {
    setMockPermissions({ trust: ['read'] });
    render(<OverviewNudges orgId="org_123" server={server()} />);
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
  });

  it('collapses to the top nudge with a stack control when several apply', () => {
    setOffboarding([{ memberId: 'm1', name: 'Jo' }]);
    render(<OverviewNudges orgId="org_123" server={server()} />);
    // Offboarding (priority 10) is shown; trust waits behind the stack.
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
    // The user is told more are waiting.
    expect(screen.getByText('nudges.noticesCount')).toBeInTheDocument();
  });

  it('expands the stack to reveal every waiting nudge, then collapses', () => {
    setOffboarding([{ memberId: 'm1', name: 'Jo' }]);
    render(<OverviewNudges orgId="org_123" server={server()} />);

    fireEvent.click(screen.getByText('nudges.noticesCount'));
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();
    expect(screen.getByText('nudges.trustSetupTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('common.less'));
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
    expect(screen.getByText('nudges.noticesCount')).toBeInTheDocument();
  });

  it('shows no stack control when only one nudge applies', () => {
    render(<OverviewNudges orgId="org_123" server={server()} />);
    expect(screen.getByText('nudges.trustSetupTitle')).toBeInTheDocument();
    expect(screen.queryByText('nudges.noticesCount')).not.toBeInTheDocument();
  });

  it('dismissing the trust nudge hides it and persists', () => {
    const { unmount } = render(<OverviewNudges orgId="org_123" server={server()} />);
    fireEvent.click(screen.getByLabelText('common.dismiss'));
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
    unmount();
    render(<OverviewNudges orgId="org_123" server={server()} />);
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
  });

  it('dismissing offboarding hides it for the session without persisting', () => {
    setOffboarding([{ memberId: 'm1', name: 'Jo' }]);
    // isConfigured: true so the trust nudge does not appear after offboarding is dismissed
    const { unmount } = render(
      <OverviewNudges orgId="org_123" server={server({ isConfigured: true })} />,
    );
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('common.dismiss'));
    expect(screen.queryByText('nudges.offboardingBody')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('overview-nudge-dismissed:offboarding:org_123')).toBeNull();

    // Not persisted → reappears on remount.
    unmount();
    render(<OverviewNudges orgId="org_123" server={server({ isConfigured: true })} />);
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();
  });

  it('renders nothing while offboarding is loading and trust is ineligible', () => {
    mockUseApiSWR.mockReturnValue({ data: undefined, error: undefined }); // SWR loading
    const { container } = render(
      <OverviewNudges orgId="org_123" server={server({ isConfigured: true })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the framework updates nudge when it is the only one eligible', () => {
    setFrameworkUpdates([{ frameworkInstanceId: 'fi_1' }]);
    // isConfigured: true → trust off; no offboarding → framework is the only nudge.
    render(<OverviewNudges orgId="org_123" server={server({ isConfigured: true })} />);
    expect(screen.getByText('framework updates available')).toBeInTheDocument();
    expect(screen.queryByText('nudges.noticesCount')).not.toBeInTheDocument();
  });

  it('orders framework updates last in the stack (offboarding, trust, framework)', () => {
    setOffboarding([{ memberId: 'm1', name: 'Jo' }]);
    setFrameworkUpdates([{ frameworkInstanceId: 'fi_1' }]);
    render(<OverviewNudges orgId="org_123" server={server()} />);

    // Collapsed: only offboarding (priority 10) on top; the other two wait.
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();
    expect(screen.queryByText('framework updates available')).not.toBeInTheDocument();
    expect(screen.queryByText('nudges.trustSetupTitle')).not.toBeInTheDocument();
    expect(screen.getByText('nudges.noticesCount')).toBeInTheDocument();

    // Expanded: all three shown, framework updates rendered after the trust nudge.
    fireEvent.click(screen.getByText('nudges.noticesCount'));
    expect(screen.getByText('nudges.offboardingBody')).toBeInTheDocument();
    const trustEl = screen.getByText('nudges.trustSetupTitle');
    const frameworkEl = screen.getByText('framework updates available');
    expect(
      trustEl.compareDocumentPosition(frameworkEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('excludes framework updates from the count while its data is loading', () => {
    setOffboarding([{ memberId: 'm1', name: 'Jo' }]);
    mockUseFrameworkUpdateStatuses.mockReturnValue({ data: undefined, error: undefined });
    render(<OverviewNudges orgId="org_123" server={server()} />);
    // offboarding + trust = 2; framework not ready, so it doesn't inflate the count.
    expect(screen.getByText('nudges.noticesCount')).toBeInTheDocument();
  });
});
