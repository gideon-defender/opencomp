import { Injectable, Logger } from '@nestjs/common';
import { triggerEmail } from '../email/trigger-email';
import { resolveEmailLocale, type EmailLocale } from '../email/locale';
import { AccessGrantedEmail } from '../email/templates/access-granted';
import { AccessReclaimEmail } from '../email/templates/access-reclaim';
import { NdaSigningEmail } from '../email/templates/nda-signing';
import { AccessRequestNotificationEmail } from '../email/templates/access-request-notification';
import { TrustDomainMisconfiguredEmail } from '../email/templates/trust-domain-misconfigured';

@Injectable()
export class TrustEmailService {
  private readonly logger = new Logger(TrustEmailService.name);

  async sendNdaSigningEmail(params: {
    toEmail: string;
    toName: string;
    organizationName: string;
    ndaSigningLink: string;
    locale?: EmailLocale;
  }): Promise<void> {
    const { toEmail, toName, organizationName, ndaSigningLink } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const { id } = await triggerEmail({
      to: toEmail,
      subject:
        emailLocale === 'es'
          ? `Firma del NDA requerida - ${organizationName}`
          : `NDA Signature Required - ${organizationName}`,
      react: NdaSigningEmail({
        locale: emailLocale,
        toName,
        organizationName,
        ndaSigningLink,
      }),
      trustPortal: true,
    });

    this.logger.log(`NDA signing email sent to ${toEmail} (ID: ${id})`);
  }

  async sendAccessGrantedEmail(params: {
    toEmail: string;
    toName: string;
    organizationName: string;
    expiresAt: Date;
    portalUrl: string;
    ndaBypassed?: boolean;
    locale?: EmailLocale;
  }): Promise<void> {
    const {
      toEmail,
      toName,
      organizationName,
      expiresAt,
      portalUrl,
      ndaBypassed,
    } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const { id } = await triggerEmail({
      to: toEmail,
      subject:
        emailLocale === 'es'
          ? `Acceso concedido - ${organizationName}`
          : `Access Granted - ${organizationName}`,
      react: AccessGrantedEmail({
        locale: emailLocale,
        toName,
        organizationName,
        expiresAt,
        portalUrl,
        ndaBypassed,
      }),
      trustPortal: true,
    });

    this.logger.log(`Access granted email sent to ${toEmail} (ID: ${id})`);
  }

  async sendAccessReclaimEmail(params: {
    toEmail: string;
    toName: string;
    organizationName: string;
    accessLink: string;
    expiresAt: Date;
    locale?: EmailLocale;
  }): Promise<void> {
    const { toEmail, toName, organizationName, accessLink, expiresAt } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const { id } = await triggerEmail({
      to: toEmail,
      subject:
        emailLocale === 'es'
          ? `Accede a tus datos de cumplimiento - ${organizationName}`
          : `Access Your Compliance Data - ${organizationName}`,
      react: AccessReclaimEmail({
        locale: emailLocale,
        toName,
        organizationName,
        accessLink,
        expiresAt,
      }),
      trustPortal: true,
    });

    this.logger.log(`Access reclaim email sent to ${toEmail} (ID: ${id})`);
  }

  async sendAccessRequestNotification(params: {
    toEmail: string;
    organizationName: string;
    requesterName: string;
    requesterEmail: string;
    requesterCompany?: string | null;
    requesterJobTitle?: string | null;
    purpose?: string | null;
    requestedDurationDays?: number | null;
    reviewUrl: string;
    locale?: EmailLocale;
  }): Promise<void> {
    const {
      toEmail,
      organizationName,
      requesterName,
      requesterEmail,
      requesterCompany,
      requesterJobTitle,
      purpose,
      requestedDurationDays,
      reviewUrl,
    } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const { id } = await triggerEmail({
      to: toEmail,
      subject:
        emailLocale === 'es'
          ? `Nueva solicitud de acceso al Portal de Confianza - ${organizationName}`
          : `New Trust Portal Access Request - ${organizationName}`,
      react: AccessRequestNotificationEmail({
        locale: emailLocale,
        organizationName,
        requesterName,
        requesterEmail,
        requesterCompany,
        requesterJobTitle,
        purpose,
        requestedDurationDays,
        reviewUrl,
      }),
      trustPortal: true,
    });

    this.logger.log(
      `Access request notification sent to ${toEmail} for requester ${requesterEmail} (ID: ${id})`,
    );
  }

  async sendDomainMisconfiguredEmail(params: {
    toEmail: string;
    toName: string;
    organizationName: string;
    domain: string;
    settingsUrl: string;
    locale?: EmailLocale;
  }): Promise<void> {
    const { toEmail, toName, organizationName, domain, settingsUrl } = params;
    const emailLocale = resolveEmailLocale(params.locale);

    const { id } = await triggerEmail({
      to: toEmail,
      subject:
        emailLocale === 'es'
          ? `Acción requerida: el dominio ${domain} del Portal de Confianza está mal configurado`
          : `Action required: Trust Portal domain ${domain} is misconfigured`,
      react: TrustDomainMisconfiguredEmail({
        locale: emailLocale,
        toName,
        organizationName,
        domain,
        settingsUrl,
      }),
      trustPortal: true,
    });

    this.logger.log(
      `Domain misconfigured email sent to ${toEmail} for domain ${domain} (ID: ${id})`,
    );
  }
}
