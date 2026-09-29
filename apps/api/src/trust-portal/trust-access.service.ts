import { Injectable } from '@nestjs/common';
import { TrustFramework } from '@db';
import {
  ApproveAccessRequestDto,
  CreateAccessRequestDto,
  DenyAccessRequestDto,
  ListAccessRequestsDto,
  RevokeGrantDto,
} from './dto/trust-access.dto';
import { TrustGrantReadsService } from './trust-grant-reads.service';
import { TrustGrantTokenService } from './trust-grant-token.service';
import { TrustDocumentDownloadService } from './trust-document-download.service';
import { TrustResourceDownloadService } from './trust-resource-download.service';
import { TrustPolicyDownloadService } from './trust-policy-download.service';
import { TrustPolicyFileDownloadService } from './trust-policy-file-download.service';
import { TrustNdaService } from './trust-nda.service';
import { TrustNdaSignService } from './trust-nda-sign.service';
import { TrustRequestIntakeService } from './trust-request-intake.service';
import { TrustRequestApprovalService } from './trust-request-approval.service';
import { TrustRequestModerationService } from './trust-request-moderation.service';
import { TrustRequestResendService } from './trust-request-resend.service';

@Injectable()
export class TrustAccessService {
  constructor(
    private readonly grantReads: TrustGrantReadsService,
    private readonly grantTokens: TrustGrantTokenService,
    private readonly documentDownloads: TrustDocumentDownloadService,
    private readonly resourceDownloads: TrustResourceDownloadService,
    private readonly policyDownloads: TrustPolicyDownloadService,
    private readonly policyFileDownloads: TrustPolicyFileDownloadService,
    private readonly ndaService: TrustNdaService,
    private readonly ndaSignService: TrustNdaSignService,
    private readonly intakeService: TrustRequestIntakeService,
    private readonly approvalService: TrustRequestApprovalService,
    private readonly moderationService: TrustRequestModerationService,
    private readonly resendService: TrustRequestResendService,
  ) {}

  async reclaimAccess(id: string, email: string, query?: string) {
    return this.grantTokens.reclaimAccess(id, email, query);
  }

  async getMemberIdFromUserId(
    userId: string,
    organizationId: string,
  ): Promise<string | undefined> {
    return this.intakeService.getMemberIdFromUserId(userId, organizationId);
  }

  async createAccessRequest(
    id: string,
    dto: CreateAccessRequestDto,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    return this.intakeService.createAccessRequest(
      id,
      dto,
      ipAddress,
      userAgent,
    );
  }

  async listAccessRequests(organizationId: string, dto: ListAccessRequestsDto) {
    return this.intakeService.listAccessRequests(organizationId, dto);
  }

  async getAccessRequest(organizationId: string, requestId: string) {
    return this.intakeService.getAccessRequest(organizationId, requestId);
  }

  async approveRequest(
    organizationId: string,
    requestId: string,
    dto: ApproveAccessRequestDto,
    memberId?: string,
  ) {
    return this.approvalService.approveRequest(
      organizationId,
      requestId,
      dto,
      memberId,
    );
  }

  async denyRequest(
    organizationId: string,
    requestId: string,
    dto: DenyAccessRequestDto,
    memberId?: string,
  ) {
    return this.moderationService.denyRequest(
      organizationId,
      requestId,
      dto,
      memberId,
    );
  }

  async listGrants(organizationId: string) {
    return this.grantReads.listGrants(organizationId);
  }

  async revokeGrant(
    organizationId: string,
    grantId: string,
    dto: RevokeGrantDto,
    memberId?: string,
  ) {
    return this.moderationService.revokeGrant(
      organizationId,
      grantId,
      dto,
      memberId,
    );
  }

  async resendAccessGrantEmail(organizationId: string, grantId: string) {
    return this.resendService.resendAccessGrantEmail(organizationId, grantId);
  }

  async getNdaByToken(token: string) {
    return this.ndaService.getNdaByToken(token);
  }

  async signNda(
    token: string,
    signerName: string,
    signerEmail: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    return this.ndaSignService.signNda(
      token,
      signerName,
      signerEmail,
      ipAddress,
      userAgent,
    );
  }

  async resendNda(organizationId: string, requestId: string) {
    return this.resendService.resendNda(organizationId, requestId);
  }

  async previewNda(organizationId: string, requestId: string) {
    return this.ndaService.previewNda(organizationId, requestId);
  }

  async previewNdaByToken(token: string) {
    return this.ndaService.previewNdaByToken(token);
  }

  /**
   * Token-gated grant reads and downloads live in focused services
   * (TrustGrantReadsService, Trust*DownloadService). These delegates keep
   * the controller-facing API stable while the implementations evolve
   * separately from the request lifecycle and NDA flows.
   */
  async getGrantByAccessToken(token: string) {
    return this.grantReads.getGrantByAccessToken(token);
  }

  async validateAccessTokenAndGetOrganizationId(
    token: string,
  ): Promise<string> {
    return this.grantReads.validateAccessTokenAndGetOrganizationId(token);
  }

  async getPoliciesByAccessToken(token: string) {
    return this.grantReads.getPoliciesByAccessToken(token);
  }

  async getComplianceResourcesByAccessToken(token: string) {
    return this.grantReads.getComplianceResourcesByAccessToken(token);
  }

  async getTrustDocumentsByAccessToken(token: string) {
    return this.grantReads.getTrustDocumentsByAccessToken(token);
  }

  async getTrustDocumentUrlByAccessToken(token: string, documentId: string) {
    return this.grantReads.getTrustDocumentUrlByAccessToken(token, documentId);
  }

  async downloadAllTrustDocumentsByAccessToken(token: string) {
    return this.documentDownloads.downloadAllTrustDocumentsByAccessToken(token);
  }

  async getComplianceResourceUrlByAccessToken(
    token: string,
    framework: TrustFramework,
  ) {
    return this.resourceDownloads.getComplianceResourceUrlByAccessToken(
      token,
      framework,
    );
  }

  async getCustomComplianceResourceUrlByAccessToken(
    token: string,
    customFrameworkId: string,
  ) {
    return this.resourceDownloads.getCustomComplianceResourceUrlByAccessToken(
      token,
      customFrameworkId,
    );
  }

  async downloadAllPoliciesByAccessToken(token: string) {
    return this.policyDownloads.downloadAllPoliciesByAccessToken(token);
  }

  async downloadPolicyByAccessToken(token: string, policyId: string) {
    return this.policyFileDownloads.downloadPolicyByAccessToken(
      token,
      policyId,
    );
  }

  async downloadAllPoliciesAsZipByAccessToken(token: string) {
    return this.policyFileDownloads.downloadAllPoliciesAsZipByAccessToken(
      token,
    );
  }
}
