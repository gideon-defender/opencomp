jest.mock('@db', () => ({
  db: {
    integrationOAuthState: { create: jest.fn() },
    integrationConnection: { findFirst: jest.fn() },
  },
}));

import { db } from '@db';
import { OAuthStateRepository } from './oauth-state.repository';
import { ConnectionRepository } from './connection.repository';

describe('OAuth reconnect persistence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists the selected connection in server-generated OAuth state', async () => {
    await new OAuthStateRepository().create({
      providerSlug: 'azure',
      organizationId: 'org_1',
      userId: 'user_1',
      connectionId: 'older_connection',
    });
    expect(db.integrationOAuthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        state: expect.stringMatching(/^[a-f0-9]{64}$/),
        connectionId: 'older_connection',
        organizationId: 'org_1',
        providerSlug: 'azure',
      }),
    });
  });

  it('scopes reconnect lookup to the exact org, provider, OAuth strategy and live status', async () => {
    await new ConnectionRepository().findOAuthTarget({
      connectionId: 'older_connection',
      organizationId: 'org_1',
      providerSlug: 'azure',
    });
    expect(db.integrationConnection.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'older_connection',
        organizationId: 'org_1',
        provider: { slug: 'azure' },
        authStrategy: 'oauth2',
        status: { not: 'disconnected' },
      },
    });
  });
});
