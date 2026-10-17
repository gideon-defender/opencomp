import { Test } from '@nestjs/testing';
import { computePeopleScore } from '../frameworks/frameworks-people-score.helper';
import { PoliciesService } from '../policies/policies.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { PolicyPdfRendererService } from '../trust-portal/policy-pdf-renderer.service';
import { TimelinesService } from '../timelines/timelines.service';

jest.mock('@db', () => ({
  db: {
    organizationRole: { findMany: jest.fn() },
    policy: { findMany: jest.fn(), update: jest.fn() },
    member: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
  Frequency: { monthly: 'monthly', quarterly: 'quarterly', yearly: 'yearly' },
  PolicyStatus: { published: 'published' },
  BackgroundCheckStatus: {
    completed: 'completed',
    completed_with_flags: 'completed_with_flags',
  },
}));
jest.mock('../attachments/attachments.service', () => ({
  AttachmentsService: class {},
}));
jest.mock('../trust-portal/policy-pdf-renderer.service', () => ({
  PolicyPdfRendererService: class {},
}));
jest.mock('../timelines/timelines.service', () => ({
  TimelinesService: class {},
}));
jest.mock('../frameworks/frameworks-timeline.helper', () => ({
  checkAutoCompletePhases: jest.fn(async () => undefined),
}));
jest.mock('../app/s3', () => ({
  BUCKET_NAME: 'test-bucket',
  getSignedUrl: jest.fn(),
  s3Client: {},
}));

type AsyncMock = jest.Mock<Promise<unknown>, unknown[]>;
const { db } = jest.requireMock<{
  db: {
    organizationRole: { findMany: AsyncMock };
    policy: { findMany: AsyncMock; update: AsyncMock };
    member: { findMany: AsyncMock };
    $transaction: AsyncMock;
  };
}>('@db');

const members = ['admin', 'employee'].map((role) => ({
  id: `mem_${role}`,
  role,
  userId: `usr_${role}`,
  user: { email: `${role}@example.com`, name: role },
  organization: { id: 'org_1', name: 'Organization' },
}));

describe('compliance obligation overrides in downstream workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.organizationRole.findMany.mockResolvedValue(
      [
        { name: 'admin', compliance: true },
        { name: 'employee', compliance: false },
      ].map(({ name, compliance }) => ({
        id: `rol_${name}`,
        name,
        permissions: '{}',
        obligations: JSON.stringify({ compliance }),
        organizationId: 'org_1',
        createdAt: new Date('2026-10-16'),
        updatedAt: new Date('2026-10-16'),
      })),
    );
  });

  it('publishes policies to opted-in admins and excludes opted-out employees', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PoliciesService,
        { provide: AttachmentsService, useValue: {} },
        { provide: PolicyPdfRendererService, useValue: {} },
        { provide: TimelinesService, useValue: {} },
      ],
    }).compile();
    try {
      db.policy.findMany.mockResolvedValue([
        { id: 'pol_1', name: 'Security', frequency: null },
      ]);
      db.member.findMany.mockResolvedValue(members);

      const result = await module.get(PoliciesService).publishAll('org_1');

      expect(result.publishedCount).toBe(1);
      expect(result.members).toEqual([
        {
          email: 'admin@example.com',
          userId: 'usr_admin',
          userName: 'admin',
          organizationName: 'Organization',
          organizationId: 'org_1',
        },
      ]);
    } finally {
      await module.close();
    }
  });

  it('scores the opted-in admin against required policies instead of the opted-out employee', async () => {
    const score = await computePeopleScore({
      organizationId: 'org_1',
      employees: members,
      allPolicies: [
        {
          isRequiredToSign: true,
          status: 'published',
          isArchived: false,
          signedBy: ['mem_employee'],
        },
      ],
      securityTrainingStepEnabled: false,
      deviceAgentStepEnabled: false,
      backgroundCheckStepEnabled: false,
      hasHipaaFramework: false,
    });

    expect(score).toEqual({ total: 1, completed: 0 });
  });
});
