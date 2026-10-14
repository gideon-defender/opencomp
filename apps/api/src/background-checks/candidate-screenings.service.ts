import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { db } from '@db';
import { CheckrIntakeConfigService } from './checkr-intake-config.service';
import type { StartCandidateScreeningDto } from './dto/start-candidate-screening.dto';
import { isUniqueConstraintError } from './background-check-webhook-dedup';

@Injectable()
export class CandidateScreeningsService {
  constructor(private readonly config: CheckrIntakeConfigService) {}

  async start(params: {
    organizationId: string;
    input: StartCandidateScreeningDto;
  }) {
    const { organizationId, input } = params;
    const existing = await db.candidateScreening.findUnique({
      where: {
        organizationId_operationId: {
          organizationId,
          operationId: input.operationId,
        },
      },
    });
    if (existing) return this.existingResult({ existing, input });
    const { connection } = await this.config.client({ organizationId });
    try {
      const screening = await db.$transaction(async (tx) => {
        const candidate = await tx.peopleCandidate.upsert({
          where: {
            organizationId_email: { organizationId, email: input.email },
          },
          create: {
            organizationId,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
          },
          update: {},
        });
        // Each attempt freezes its own submitted names/email/location.
        return tx.candidateScreening.create({
          data: {
            ...input,
            organizationId,
            candidateId: candidate.id,
            connectionId: connection.id,
            package: connection.package,
            node: connection.node,
          },
        });
      });
      return { runId: screening.id, status: screening.status };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await db.candidateScreening.findUnique({
        where: {
          organizationId_operationId: {
            organizationId,
            operationId: input.operationId,
          },
        },
      });
      if (!raced) throw error;
      return this.existingResult({ existing: raced, input });
    }
  }

  private existingResult(params: {
    existing: Awaited<
      ReturnType<typeof db.candidateScreening.findUniqueOrThrow>
    >;
    input: StartCandidateScreeningDto;
  }) {
    const { existing, input } = params;
    if (
      existing.email !== input.email ||
      existing.firstName !== input.firstName ||
      existing.lastName !== input.lastName ||
      existing.country !== input.country ||
      existing.state !== (input.state ?? null) ||
      existing.city !== (input.city ?? null)
    ) {
      throw new ConflictException(
        'This operation ID belongs to different screening details.',
      );
    }
    return { runId: existing.id, status: existing.status };
  }

  async list(organizationId: string) {
    const where = { organizationId };
    const [data, count] = await Promise.all([
      db.candidateScreening.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          candidateId: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          errorCode: true,
          createdAt: true,
          dispatchedAt: true,
        },
      }),
      db.candidateScreening.count({ where }),
    ]);
    return { data, count };
  }

  async get(params: { organizationId: string; id: string }) {
    const screening = await db.candidateScreening.findFirst({
      where: params,
      select: {
        id: true,
        candidateId: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        errorCode: true,
        createdAt: true,
        dispatchedAt: true,
      },
    });
    if (!screening)
      throw new NotFoundException('Candidate screening not found.');
    return screening;
  }
}
