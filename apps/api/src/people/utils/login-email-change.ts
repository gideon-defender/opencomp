import { ConflictException, Logger, ForbiddenException } from '@nestjs/common';
import { db, normalizeEmail } from '@db';
import { triggerEmail } from '../../email/trigger-email';
import { resolveEmailLocale, type EmailLocale } from '../../email/locale';
import { LoginEmailChangedEmail } from '../../email/templates/login-email-changed';

export interface LoginEmailChange {
  oldEmail: string;
  newEmail: string;
}

/** Tenant ownership does not separate legacy memberships until the contract split. */
export async function validateLoginEmailChange(params: {
  userId: string;
  organizationId: string;
  requestedEmail: string;
}): Promise<LoginEmailChange | null> {
  const { userId, organizationId, requestedEmail } = params;
  const newEmail = normalizeEmail(requestedEmail);

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, tenantId: true },
  });

  if (normalizeEmail(user.email) === newEmail) {
    return null;
  }

  if (user.tenantId !== organizationId) {
    throw new ForbiddenException(
      'This member belongs to a different organization and cannot be renamed from here.',
    );
  }

  const otherMemberships = await db.member.count({
    where: { userId, organizationId: { not: organizationId } },
  });
  if (otherMemberships > 0) {
    throw new ConflictException(
      'This account still belongs to other organizations and cannot be renamed until tenant migration completes.',
    );
  }

  const emailTaken = await db.user.findFirst({
    where: {
      tenantId: user.tenantId,
      email: { equals: newEmail, mode: 'insensitive' },
      id: { not: userId },
    },
    select: { id: true },
  });
  if (emailTaken) {
    throw new ConflictException(
      'That email is already used by another account in this organization',
    );
  }

  return { oldEmail: user.email, newEmail };
}

/**
 * Notifies both the old and new address that the login email changed.
 * Fire-and-forget: a notification failure must not fail the update itself.
 */
export async function notifyLoginEmailChanged(params: {
  organizationId: string;
  memberId: string;
  change: LoginEmailChange;
  logger: Logger;
  locale?: EmailLocale;
}): Promise<void> {
  const { organizationId, memberId, change, logger } = params;
  const emailLocale = resolveEmailLocale(params.locale);

  try {
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });

    await Promise.all(
      [change.oldEmail, change.newEmail].map((to) =>
        triggerEmail({
          // No userId: the old-address link must stay verifiable after the
          // rename, but a user-scoped token binds the current email and
          // would 400 for the old address. The legacy email-only token
          // verifies either address.
          to,
          subject:
            emailLocale === 'es'
              ? 'Tu correo de inicio de sesión de OpenComp ha cambiado'
              : 'Your OpenComp login email was changed',
          react: LoginEmailChangedEmail({
            locale: emailLocale,
            organizationName: organization.name,
            oldEmail: change.oldEmail,
            newEmail: change.newEmail,
          }),
        }),
      ),
    );
  } catch (error) {
    // Log ids only — raw emails are PII and must not reach server logs.
    logger.error(
      `Failed to send login email change notifications (member ${memberId} in org ${organizationId}):`,
      error,
    );
  }
}
