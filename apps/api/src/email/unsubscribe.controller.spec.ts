import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { db } from '@db';
import {
  generateUnsubscribeToken,
  generateUserUnsubscribeToken,
} from '@gideon-defender/email';
import {
  UnsubscribeBodyDto,
  UnsubscribeController,
} from './unsubscribe.controller';

jest.mock('@db', () => ({
  normalizeEmail: jest.requireActual('@gideon-defender/email').normalizeEmail,
  db: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockedDb = db as unknown as {
  user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
};

describe('UnsubscribeController (tenant-scoped)', () => {
  const controller = new UnsubscribeController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unsubscribes exactly one account via a user-scoped link', async () => {
    const userId = 'usr_a';
    const email = 'Person@Example.com';
    const token = generateUserUnsubscribeToken({
      userId,
      email: email.trim().toLowerCase(),
    });
    mockedDb.user.findUnique.mockResolvedValue({ id: userId, email });
    mockedDb.user.update.mockResolvedValue({ id: userId });

    await expect(
      controller.unsubscribe(email, token, userId, undefined),
    ).resolves.toEqual({ success: true });
    expect(mockedDb.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: expect.objectContaining({
        emailNotificationsUnsubscribed: true,
      }),
    });
  });

  it('unsubscribes the secondary clone for a pre-split tenant link', async () => {
    const email = 'shared@example.com';
    const userId = 'shared';
    const organizationId = 'secondary';
    const token = generateUserUnsubscribeToken({
      email,
      userId,
      organizationId,
    });
    mockedDb.user.findUnique.mockResolvedValue({ id: userId, email });
    mockedDb.user.findMany.mockResolvedValue([{ id: 'clone', email }]);
    await expect(
      controller.unsubscribe(email, token, userId, undefined, organizationId),
    ).resolves.toEqual({ success: true });
    expect(mockedDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'clone' } }),
    );
    mockedDb.user.update.mockClear();
    await expect(
      controller.unsubscribe(email, token, userId, undefined, 'primary'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.user.update).not.toHaveBeenCalled();
  });

  it('rejects a user-scoped token reused for another tenant’s same-email account', async () => {
    const token = generateUserUnsubscribeToken({
      userId: 'usr_a',
      email: 'person@example.com',
    });
    mockedDb.user.findUnique.mockResolvedValue({
      id: 'usr_b',
      email: 'person@example.com',
    });

    await expect(
      controller.unsubscribe('person@example.com', token, 'usr_b', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.user.update).not.toHaveBeenCalled();
  });

  it('unsubscribes via a legacy email-only link when a single account matches', async () => {
    const email = 'solo@example.com';
    mockedDb.user.findMany.mockResolvedValue([{ id: 'usr_solo' }]);
    mockedDb.user.update.mockResolvedValue({ id: 'usr_solo' });

    await expect(
      controller.unsubscribe(
        email,
        generateUnsubscribeToken(email),
        undefined,
        undefined,
      ),
    ).resolves.toEqual({ success: true });
    expect(mockedDb.user.update).toHaveBeenCalledWith({
      where: { id: 'usr_solo' },
      data: expect.objectContaining({
        emailNotificationsUnsubscribed: true,
      }),
    });
  });

  it('returns success without changing any account when several tenants share the address', async () => {
    // RFC 8058 machine callers need a 2xx (anything else triggers retries
    // for a request that can never succeed); the recipient unsubscribes via
    // their scoped link from the email body instead.
    const email = 'person@example.com';
    mockedDb.user.findMany.mockResolvedValue([
      { id: 'usr_a' },
      { id: 'usr_b' },
    ]);

    await expect(
      controller.unsubscribe(
        email,
        generateUnsubscribeToken(email),
        undefined,
        undefined,
      ),
    ).resolves.toEqual({ success: true });
    expect(mockedDb.user.update).not.toHaveBeenCalled();
  });

  it('accepts a pre-scoping raw token for a single account', async () => {
    const email = 'Person@Example.com';
    const rawToken = createHmac('sha256', process.env.UNSUBSCRIBE_SECRET!)
      .update(email)
      .digest('base64url');
    mockedDb.user.findMany.mockResolvedValue([{ id: 'usr_solo' }]);
    mockedDb.user.update.mockResolvedValue({ id: 'usr_solo' });

    await expect(
      controller.unsubscribe(email, rawToken, undefined, undefined),
    ).resolves.toEqual({ success: true });
    expect(mockedDb.user.update).toHaveBeenCalledWith({
      where: { id: 'usr_solo' },
      data: expect.objectContaining({
        emailNotificationsUnsubscribed: true,
      }),
    });
  });

  it('rejects a forged user-scoped token without touching any account', async () => {
    mockedDb.user.findUnique.mockResolvedValue({
      id: 'usr_a',
      email: 'person@example.com',
    });

    await expect(
      controller.unsubscribe(
        'person@example.com',
        'forged-token',
        'usr_a',
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.user.update).not.toHaveBeenCalled();
  });

  it('rejects a forged legacy token without touching any account', async () => {
    await expect(
      controller.unsubscribe(
        'person@example.com',
        'forged-token',
        undefined,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockedDb.user.findMany).not.toHaveBeenCalled();
    expect(mockedDb.user.update).not.toHaveBeenCalled();
  });
});

describe('UnsubscribeBodyDto (global ValidationPipe)', () => {
  // Mirror of the global pipe in apps/api/src/main.ts. Gmail POSTs
  // List-Unsubscribe=One-Click as a urlencoded body field alongside the
  // query params — the DTO must allowlist it or every Gmail one-click 400s.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  it('accepts the Gmail one-click body field with query-param credentials', async () => {
    const email = 'solo@example.com';
    const body = {
      email,
      token: generateUnsubscribeToken(email),
      'List-Unsubscribe': 'One-Click',
    };
    const out = await pipe.transform(body, {
      type: 'body',
      metatype: UnsubscribeBodyDto,
    });
    expect(out).toBeInstanceOf(UnsubscribeBodyDto);
    expect(out).toMatchObject({ email, 'List-Unsubscribe': 'One-Click' });
  });

  it('still rejects unknown body fields', async () => {
    await expect(
      pipe.transform(
        { injected: 'x' },
        {
          type: 'body',
          metatype: UnsubscribeBodyDto,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
