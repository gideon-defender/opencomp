export function ndaFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'nda_1',
    organizationName: 'Acme',
    friendlyUrl: 'acme',
    faviconUrl: null,
    logoUrl: null,
    primaryColor: null,
    requesterName: 'Ada Lovelace',
    requesterEmail: 'ada@company.com',
    expiresAt: '2027-01-01T00:00:00.000Z',
    portalUrl: 'https://trust.example.com/acme',
    status: 'pending',
    ...overrides,
  };
}
