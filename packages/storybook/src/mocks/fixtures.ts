import { faker } from '@faker-js/faker';

faker.seed(42);

export const org = {
  id: 'org_demo0000000000000001',
  name: 'Acme Corporation',
  website: 'https://acme.example.com',
  logoUrl: null,
  advancedModeEnabled: true,
};

export const user = {
  id: 'usr_demo0000000000000001',
  email: 'jane.doe@acme.example.com',
  name: 'Jane Doe',
  image: null,
};

export const member = {
  id: 'mem_demo0000000000000001',
  name: 'Jane Doe',
  email: 'jane.doe@acme.example.com',
  title: 'Compliance Manager',
  department: 'Governance',
  // `owner` resolves to the full built-in permission set, so permission-gated
  // components render their real UI instead of their denied fallback.
  role: 'owner',
  status: 'active',
};

/** Shape better-auth's organization plugin returns from get-active-member. */
export const activeMember = {
  id: member.id,
  userId: user.id,
  organizationId: org.id,
  role: member.role,
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  user: { id: user.id, name: user.name, email: user.email, image: user.image },
};

export const framework = {
  id: 'fwk_demo0000000000000001',
  name: 'SOC 2 Type 2',
  version: '2026.1',
  compliance: 64,
  status: 'active',
  controls: faker.number.int({ min: 20, max: 60 }),
};

export const control = {
  id: 'ctl_demo0000000000000001',
  title: 'Access control policy',
  description: 'Formal access control policy is documented and reviewed annually.',
  frameworkId: framework.id,
  status: 'in_progress',
  policies: 3,
  tasks: 2,
  documents: 1,
};

export const policy = {
  id: 'pol_demo0000000000000001',
  title: 'Information Security Policy',
  department: 'Governance',
  status: 'published',
  version: 3,
  assignee: 'Jane Doe',
  reviewFrequency: 'annual',
  reviewDate: '2027-01-15',
  controls: [control.id],
};

export const task = {
  id: 'tsk_demo0000000000000001',
  title: 'Review access control policy',
  description: 'Annual review of the access control policy with IT leadership.',
  status: 'in_progress',
  priority: 'high',
  assignee: 'Jane Doe',
  dueDate: '2026-11-30',
  framework: 'SOC 2 Type 2',
  control: control.title,
  automationStatus: 'manual',
};

export const risk = {
  id: 'rsk_demo0000000000000001',
  title: 'Unauthorized data access',
  description: 'Risk of unauthorized access to production data.',
  category: 'Security',
  severity: 'high',
  likelihood: 3,
  impact: 4,
  status: 'open',
  treatmentPlan: 'mitigate',
};

export const vendor = {
  id: 'vnd_demo0000000000000001',
  name: 'CloudHost Pro',
  category: 'Infrastructure',
  website: 'https://cloudhost.example.com',
  status: 'assessed',
  assignee: 'Jane Doe',
  subprocessor: false,
};

export const finding = {
  id: 'fnd_demo0000000000000001',
  title: 'Outdated firewall rules',
  details: 'Several firewall rules are no longer required and should be removed.',
  severity: 'medium',
  status: 'open',
  framework: 'SOC 2 Type 2',
  category: 'Security',
};

export const integration = {
  id: 'int_demo0000000000000001',
  provider: 'google_workspace',
  name: 'Google Workspace',
  status: 'connected',
  lastSync: '2026-10-17T10:30:00Z',
  services: ['Directory', 'Calendar'],
};

export const listEnvelope = <T>(items: T[]) => ({
  data: items,
  count: items.length,
  authType: 'session',
  authenticatedUser: user,
});

export const singleEnvelope = <T>(entity: T) => ({
  ...entity,
  authType: 'session',
  authenticatedUser: user,
});

export const featureFlags = {
  'ai-vendor-questionnaire': true,
  'is-web-automations-enabled': true,
  'is-ai-policy-assistant-enabled': false,
  'is-timeline-enabled': true,
  'is-isms-enabled': true,
};
