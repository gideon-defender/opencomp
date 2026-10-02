import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/utils/auth', async () => {
  const { mockAuth } = await import('@/test-utils/mocks/auth');
  return { auth: mockAuth };
});

vi.mock('@db/server', async () => {
  const { mockDb } = await import('@/test-utils/mocks/db');
  const actual = await vi.importActual<typeof import('@db')>('@db');
  return { ...actual, db: mockDb };
});

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('@/components/layout/MinimalHeader', () => ({
  MinimalHeader: () => <div data-testid="minimal-header-stub" />,
}));

vi.mock('../../setup/components/OnboardingSidebar', () => ({
  OnboardingSidebar: () => <div data-testid="onboarding-sidebar-stub" />,
}));

vi.mock('@/components/dialogs/checkout-complete-dialog', () => ({
  CheckoutCompleteDialog: () => <div data-testid="checkout-dialog-stub" />,
}));

import { createMockSession, setupAuthMocks } from '@/test-utils/mocks/auth';
import { mockDb } from '@/test-utils/mocks/db';

const { default: OnboardingRouteLayout } = await import('./layout');

describe('OnboardingRouteLayout membership gate', () => {
  const orgId = 'org_test123';
  const userId = 'user_test123';

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.member.findFirst.mockResolvedValue({
      id: 'member_1',
      userId,
      organizationId: orgId,
      isActive: true,
      deactivated: false,
    });
  });

  it('renders for an active member', async () => {
    setupAuthMocks({ session: createMockSession() });

    const result = await OnboardingRouteLayout({
      children: null,
      params: Promise.resolve({ orgId }),
    });

    expect(result).toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('filters the membership lookup on isActive (parity with /v1/auth/me)', async () => {
    setupAuthMocks({ session: createMockSession() });

    await OnboardingRouteLayout({
      children: null,
      params: Promise.resolve({ orgId }),
    });

    expect(mockDb.member.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        organizationId: orgId,
        deactivated: false,
        isActive: true,
      },
    });
  });

  it('rejects a soft-removed member (isActive false matches nothing)', async () => {
    setupAuthMocks({ session: createMockSession() });
    // A removed row (isActive: false) matches no filter above, so the
    // lookup returns null and the layout must 404.
    mockDb.member.findFirst.mockResolvedValue(null);

    await expect(
      OnboardingRouteLayout({
        children: null,
        params: Promise.resolve({ orgId }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('scopes the lookup to the route organization', async () => {
    setupAuthMocks({ session: createMockSession() });
    mockDb.member.findFirst.mockResolvedValue(null);

    await expect(
      OnboardingRouteLayout({
        children: null,
        params: Promise.resolve({ orgId: 'org_other' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockDb.member.findFirst).toHaveBeenCalledWith({
      where: {
        userId,
        organizationId: 'org_other',
        deactivated: false,
        isActive: true,
      },
    });
  });

  it('rejects an unauthenticated visitor without hitting the database', async () => {
    setupAuthMocks({ session: null, user: null });

    await expect(
      OnboardingRouteLayout({
        children: null,
        params: Promise.resolve({ orgId }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockDb.member.findFirst).not.toHaveBeenCalled();
  });
});
