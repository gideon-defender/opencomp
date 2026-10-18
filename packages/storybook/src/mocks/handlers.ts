import { http, HttpResponse } from 'msw';
import {
  org,
  user,
  member,
  activeMember,
  framework,
  control,
  policy,
  task,
  risk,
  vendor,
  finding,
  integration,
  listEnvelope,
  singleEnvelope,
  featureFlags,
} from './fixtures';

const session = {
  session: {
    id: 'ses_demo0000000000001',
    userId: user.id,
    activeOrganizationId: org.id,
    expiresAt: new Date('2099-01-01T00:00:00.000Z').toISOString(),
  },
  user,
};

export const handlers = [
  http.get('*/v1/organization', () => HttpResponse.json(singleEnvelope(org))),
  http.get('*/v1/organization/*/members', () => HttpResponse.json(listEnvelope([member]))),
  http.get('*/v1/organization/*/frameworks', () => HttpResponse.json(listEnvelope([framework]))),
  http.get('*/v1/organization/*/controls', () => HttpResponse.json(listEnvelope([control]))),
  http.get('*/v1/organization/*/policies', () => HttpResponse.json(listEnvelope([policy]))),
  http.get('*/v1/organization/*/tasks', () => HttpResponse.json(listEnvelope([task]))),
  http.get('*/v1/organization/*/risks', () => HttpResponse.json(listEnvelope([risk]))),
  http.get('*/v1/organization/*/vendors', () => HttpResponse.json(listEnvelope([vendor]))),
  http.get('*/v1/organization/*/findings', () => HttpResponse.json(listEnvelope([finding]))),
  http.get('*/v1/organization/*/integrations', () => HttpResponse.json(listEnvelope([integration]))),
  http.get('*/v1/assistant-chat/history', () => HttpResponse.json({ messages: [] })),
  http.get('*/v1/auth/me', () =>
    HttpResponse.json({ user, authType: 'session', hasInactiveMembership: false }),
  ),
  http.get('*/v1/auth/get-session', () => HttpResponse.json(session)),
  // better-auth's client talks to `/api/auth/*`, not `/v1/auth/*`. Without
  // these the viewer is signed out, `usePermissions()` resolves to nothing and
  // every permission-gated component renders its denied fallback (usually null).
  http.get('*/api/auth/get-session', () => HttpResponse.json(session)),
  http.get('*/api/auth/organization/get-active-member', () => HttpResponse.json(activeMember)),
  http.get('*/api/auth/organization/get-full-organization', () =>
    HttpResponse.json({ ...org, members: [activeMember], invitations: [] }),
  ),
  http.get('*/api/auth/organization/list', () => HttpResponse.json([org])),
  http.get('*/v1/roles/permissions', () => HttpResponse.json({ permissions: {}, obligations: {} })),
  http.get('*/v1/feature-flags', () => HttpResponse.json({ flags: featureFlags })),
  http.post('*/v1/feature-flags/evaluate', () => HttpResponse.json(featureFlags)),
];
