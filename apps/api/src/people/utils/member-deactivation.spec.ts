jest.mock('@db', () => ({
  db: {
    organization: {
      findUnique: jest.fn(),
    },
    member: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@gideon-defender/email', () => ({
  isUserUnsubscribed: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../email/trigger-email', () => ({
  triggerEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../email/locale', () => ({
  resolveEmailLocale: () => 'en',
}));

jest.mock('../../email/templates/unassigned-items-notification', () => ({
  UnassignedItemsNotificationEmail: jest.fn(() => ({})),
}));

import { db } from '@db';
import { isUserUnsubscribed } from '@gideon-defender/email';
import { triggerEmail } from '../../email/trigger-email';
import { notifyOwnerOfUnassignedItems } from './member-deactivation';

const ITEMS = [{ type: 'task' as const, id: 'task_1', name: 'Q4 audit' }];

function member({
  id,
  role,
  email,
}: {
  id: string;
  role: string;
  email: string;
}) {
  return {
    id,
    role,
    userId: `usr_${id}`,
    user: { email, name: 'Owner' },
  };
}

describe('notifyOwnerOfUnassignedItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.organization.findUnique as jest.Mock).mockResolvedValue({
      name: 'Acme',
    });
    (isUserUnsubscribed as jest.Mock).mockResolvedValue(false);
  });

  it('picks the exact owner when a custom co-owner role joins first', async () => {
    (db.member.findMany as jest.Mock).mockResolvedValue([
      member({ id: 'mem_co', role: 'co-owner', email: 'co@acme.dev' }),
      member({ id: 'mem_owner', role: 'owner', email: 'owner@acme.dev' }),
    ]);

    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: ITEMS,
    });

    // Exact match: the substring filter would have picked co-owner.
    expect(db.member.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deactivated: false },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(triggerEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@acme.dev' }),
    );
  });

  it('still notifies the owner when the sole owner is inactive but not deactivated', async () => {
    // `isActive` and `deactivated` are independent flags: an invited or
    // suspended owner still owns the org, so the scan must not filter on it.
    (db.member.findMany as jest.Mock).mockResolvedValue([
      member({ id: 'mem_owner', role: 'owner', email: 'owner@acme.dev' }),
    ]);

    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: ITEMS,
    });

    expect(db.member.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deactivated: false },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(triggerEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@acme.dev' }),
    );
  });

  it('sends nothing when only a custom co-owner exists', async () => {
    (db.member.findMany as jest.Mock).mockResolvedValue([
      member({ id: 'mem_co', role: 'co-owner', email: 'co@acme.dev' }),
    ]);

    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: ITEMS,
    });

    expect(triggerEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when there are no unassigned items', async () => {
    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: [],
    });

    expect(db.organization.findUnique).not.toHaveBeenCalled();
    expect(triggerEmail).not.toHaveBeenCalled();
  });

  it('scopes the unsubscribe check to the organization and links the owner account', async () => {
    (db.member.findMany as jest.Mock).mockResolvedValue([
      member({ id: 'mem_owner', role: 'owner', email: 'owner@acme.dev' }),
    ]);

    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: ITEMS,
    });

    // Tenant isolation: the org id must reach the unsubscribe gate so a
    // same-email account in another tenant can never satisfy this check.
    expect(isUserUnsubscribed).toHaveBeenCalledWith(
      db,
      'owner@acme.dev',
      'unassignedItemsNotifications',
      'org_1',
    );
    // The owner mail must carry the account id so Gmail one-click hits the
    // tenant-scoped link instead of the ambiguous legacy email-only link.
    expect(triggerEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@acme.dev',
        userId: 'usr_mem_owner',
      }),
    );
  });

  it('sends nothing when the owner unsubscribed in this organization', async () => {
    (db.member.findMany as jest.Mock).mockResolvedValue([
      member({ id: 'mem_owner', role: 'owner', email: 'owner@acme.dev' }),
    ]);
    (isUserUnsubscribed as jest.Mock).mockResolvedValue(true);

    await notifyOwnerOfUnassignedItems({
      organizationId: 'org_1',
      removedMemberName: 'Leaver',
      unassignedItems: ITEMS,
    });

    expect(triggerEmail).not.toHaveBeenCalled();
  });
});
