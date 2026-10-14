import type { Prisma } from '@db';

export const MEMBER_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  role: true,
  createdAt: true,
  department: true,
  jobTitle: true,
  isActive: true,
  deactivated: true,
  backgroundCheckExempt: true,
  backgroundCheckExemptReason: true,
  backgroundCheckExemptJustification: true,
  onboardDate: true,
  offboardDate: true,
  fleetDmLabelId: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      image: true,
      createdAt: true,
      updatedAt: true,
      lastLogin: true,
    },
  },
  backgroundCheckRequests: {
    select: {
      id: true,
      status: true,
      requesterNotes: true,
    },
    take: 1,
    orderBy: { createdAt: 'desc' },
  },
} as const satisfies Prisma.MemberSelect;
