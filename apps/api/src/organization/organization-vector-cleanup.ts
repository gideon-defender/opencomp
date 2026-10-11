import { Injectable, Logger } from '@nestjs/common';
import { deleteOrganizationEmbeddings } from '../vector-store/lib/core/delete-embeddings';

@Injectable()
export class OrganizationVectorCleanupService {
  private readonly logger = new Logger(OrganizationVectorCleanupService.name);

  async deleteOrganizationVectors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{
    deleted: boolean;
    errors: string[];
  }> {
    try {
      await deleteOrganizationEmbeddings(organizationId);
      return { deleted: true, errors: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Vector cleanup failed for ${organizationId}: ${message}`,
      );
      return { deleted: false, errors: [`vector cleanup: ${message}`] };
    }
  }
}
