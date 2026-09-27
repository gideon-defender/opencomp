import { db } from '@db';
import { Injectable, Logger } from '@nestjs/common';
import { isUserUnsubscribed } from '@gideon-defender/email';
import { triggerEmail } from '../email/trigger-email';
import { resolveEmailLocale, type EmailLocale } from '../email/locale';
import { EvidenceAccessRequestSubmittedEmail } from '../email/templates/evidence-access-request-submitted';

interface Recipient {
  userId: string;
  email: string;
  name: string;
}

function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'https://app.gideondefender.com'
  );
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class EvidenceFormsNotifierService {
  private readonly logger = new Logger(EvidenceFormsNotifierService.name);

  async notifyAccessRequestSubmitted(params: {
    organizationId: string;
    submitterUserId: string;
    submitterName: string;
    submissionId: string;
    data: Record<string, unknown>;
    locale?: EmailLocale;
  }): Promise<void> {
    const {
      organizationId,
      submitterUserId,
      submitterName,
      submissionId,
      data,
    } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const recipients = await this.getOwnersAndAdmins(
      organizationId,
      submitterUserId,
    );
    if (recipients.length === 0) {
      this.logger.log(
        'No owner/admin recipients for access request notification',
      );
      return;
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    const organizationName = organization?.name ?? 'your organization';
    const reviewUrl = `${getAppUrl()}/${organizationId}/documents/access-request/submissions/${submissionId}`;

    await Promise.allSettled(
      recipients.map((recipient) =>
        this.sendToRecipient({
          recipient,
          locale: emailLocale,
          organizationName,
          submitterName,
          reviewUrl,
          accountsNeeded: stringField(data, 'accountsNeeded'),
          permissionsNeeded: stringField(data, 'permissionsNeeded'),
          reasonForRequest: stringField(data, 'reasonForRequest'),
        }),
      ),
    );
  }

  private async sendToRecipient(params: {
    recipient: Recipient;
    organizationName: string;
    submitterName: string;
    reviewUrl: string;
    accountsNeeded: string;
    permissionsNeeded: string;
    reasonForRequest: string;
    locale?: EmailLocale;
  }): Promise<void> {
    const { recipient, submitterName, organizationName, reviewUrl } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    try {
      const isUnsubscribed = await isUserUnsubscribed(db, recipient.email);
      if (isUnsubscribed) {
        this.logger.log(
          `Skipping access request notification: ${recipient.email} unsubscribed`,
        );
        return;
      }

      await triggerEmail({
        to: recipient.email,
        subject:
          emailLocale === 'es'
            ? `Nueva solicitud de acceso de ${submitterName}`
            : `New access request from ${submitterName}`,
        react: EvidenceAccessRequestSubmittedEmail({
          locale: emailLocale,
          toName: recipient.name,
          toEmail: recipient.email,
          organizationName,
          requesterName: submitterName,
          accountsNeeded: params.accountsNeeded,
          permissionsNeeded: params.permissionsNeeded,
          reasonForRequest: params.reasonForRequest,
          reviewUrl,
        }),
        system: true,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send access request notification to ${recipient.email}:`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async getOwnersAndAdmins(
    organizationId: string,
    excludeUserId: string,
  ): Promise<Recipient[]> {
    try {
      const members = await db.member.findMany({
        where: { organizationId, deactivated: false, isActive: true },
        select: {
          role: true,
          user: { select: { id: true, email: true, name: true } },
        },
      });

      const seen = new Set<string>();
      const recipients: Recipient[] = [];
      for (const member of members) {
        if (!member.role.includes('admin') && !member.role.includes('owner')) {
          continue;
        }
        const { user } = member;
        if (user.id === excludeUserId || !user.email || seen.has(user.id)) {
          continue;
        }
        seen.add(user.id);
        recipients.push({
          userId: user.id,
          email: user.email,
          name: user.name || user.email,
        });
      }
      return recipients;
    } catch (error) {
      this.logger.error('Failed to resolve owners/admins:', error);
      return [];
    }
  }
}
