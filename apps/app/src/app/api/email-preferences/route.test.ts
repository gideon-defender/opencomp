import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@db/server', async () => {
  const { mockDb } = await import('@/test-utils/mocks/db');
  const actual = await vi.importActual<typeof import('@db/server')>('@db/server');
  return { ...actual, db: mockDb };
});

import { mockDb } from '@/test-utils/mocks/db';
import { generateUnsubscribeToken, generateUserUnsubscribeToken } from '@gideon-defender/email';
import { PUT } from './route';

const mockFindUnique = vi.mocked(mockDb.user.findUnique);
const mockFindMany = vi.mocked(mockDb.user.findMany);
const mockUpdate = vi.mocked(mockDb.user.update);

const FULL_PREFERENCES = {
  policyNotifications: true,
  taskReminders: true,
  weeklyTaskDigest: true,
  unassignedItemsNotifications: true,
  taskMentions: true,
  taskAssignments: true,
  findingNotifications: false,
};

process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-route-test';

function createRequest(body: unknown): Request {
  if (
    body &&
    typeof body === 'object' &&
    'token' in body &&
    body.token === 'tok' &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    const userId = 'userId' in body && typeof body.userId === 'string' ? body.userId : undefined;
    body = {
      ...body,
      token: userId
        ? generateUserUnsubscribeToken({ userId, email: body.email })
        : generateUnsubscribeToken(body.email),
    };
  }
  return new Request('http://localhost:3000/api/email-preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PUT /api/email-preferences', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return 400 when findingNotifications is missing (all 7 keys required)', async () => {
    // Simulate a client that never adopted findingNotifications.
    const sixKeys = Object.fromEntries(
      Object.entries(FULL_PREFERENCES).filter(([key]) => key !== 'findingNotifications'),
    );

    const response = await PUT(
      createRequest({
        email: 'user@test.com',
        token: 'tok',
        userId: 'usr_1',
        preferences: sixKeys,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should persist all 7 preference keys including findingNotifications', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'usr_1',
      email: 'user@test.com',
    });
    mockUpdate.mockResolvedValue({});

    const response = await PUT(
      createRequest({
        email: 'user@test.com',
        token: 'tok',
        userId: 'usr_1',
        preferences: FULL_PREFERENCES,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: {
        emailPreferences: FULL_PREFERENCES,
        emailNotificationsUnsubscribed: false,
      },
    });
    expect(Object.keys(mockUpdate.mock.calls[0][0].data.emailPreferences)).toHaveLength(7);
  });

  it('should keep findingNotifications=false on the legacy email-only path', async () => {
    mockFindMany.mockResolvedValue([{ id: 'usr_1' }]);
    mockUpdate.mockResolvedValue({});

    const allOff = {
      policyNotifications: false,
      taskReminders: false,
      weeklyTaskDigest: false,
      unassignedItemsNotifications: false,
      taskMentions: false,
      taskAssignments: false,
      findingNotifications: false,
    };

    const response = await PUT(
      createRequest({
        email: 'user@test.com',
        token: 'tok',
        preferences: allOff,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'usr_1' },
      data: {
        emailPreferences: allOff,
        emailNotificationsUnsubscribed: true,
      },
    });
  });

  it('should return 403 for a forged user-scoped token without updating', async () => {
    mockFindUnique.mockResolvedValue({ id: 'usr_1', email: 'user@test.com' });

    const response = await PUT(
      createRequest({
        email: 'user@test.com',
        token: 'forged',
        userId: 'usr_1',
        preferences: FULL_PREFERENCES,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should return 403 when the userId does not own the email', async () => {
    // Token is valid for usr_2, but the caller presents usr_1: the
    // user-scoped path must not let one tenant account act for another.
    mockFindUnique.mockResolvedValue({ id: 'usr_1', email: 'other@test.com' });

    const response = await PUT(
      createRequest({
        email: 'user@test.com',
        token: 'tok',
        userId: 'usr_1',
        preferences: FULL_PREFERENCES,
      }),
    );

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should return 409 when the legacy address is shared by several tenants', async () => {
    mockFindMany.mockResolvedValue([{ id: 'usr_a' }, { id: 'usr_b' }]);

    const response = await PUT(
      createRequest({
        email: 'shared@test.com',
        token: 'tok',
        preferences: FULL_PREFERENCES,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates the secondary clone for a link sent before the tenant split', async () => {
    const email = 'shared@test.com';
    const organizationId = 'secondary';
    const userId = 'shared';
    mockFindUnique.mockResolvedValue({ id: userId, email });
    mockFindMany.mockResolvedValue([{ id: 'clone', email }]);
    mockUpdate.mockResolvedValue({});
    const token = generateUserUnsubscribeToken({ userId, email, organizationId });
    const response = await PUT(
      createRequest({ email, userId, organizationId, token, preferences: FULL_PREFERENCES }),
    );
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'clone' } }));
    mockUpdate.mockClear();
    const forged = await PUT(
      createRequest({
        email,
        userId,
        organizationId: 'primary',
        token,
        preferences: FULL_PREFERENCES,
      }),
    );
    expect(forged.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should return 404 when the legacy address matches no account', async () => {
    mockFindMany.mockResolvedValue([]);

    const response = await PUT(
      createRequest({
        email: 'ghost@test.com',
        token: 'tok',
        preferences: FULL_PREFERENCES,
      }),
    );

    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
