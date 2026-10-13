import { db, normalizeEmail } from '@db/server';
import {
  getUnsubscribeUrl,
  getUserUnsubscribeUrl,
  resolveUnsubscribeUser,
  verifyUnsubscribeToken,
} from '@gideon-defender/email';
import { redirect } from 'next/navigation';

interface PageProps {
  searchParams: Promise<{
    success?: string | string[];
    email?: string | string[];
    userId?: string | string[];
    organizationId?: string | string[];
    token?: string | string[];
  }>;
}

/** Query params can be arrays when repeated — only single strings are valid. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function UnsubscribePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const success = firstParam(params.success);
  const email = firstParam(params.email);
  const userId = firstParam(params.userId);
  const organizationId = firstParam(params.organizationId);
  const token = firstParam(params.token);

  if (success === 'true' && email) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <div className="text-center">
            <div className="mb-4 text-4xl">✓</div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">Successfully Unsubscribed</h1>
            <p className="mb-6 text-gray-600">
              You have been unsubscribed from email notifications and reminders. You will no longer
              receive these emails at <span className="font-semibold">{email}</span>.
            </p>
            <p className="text-sm text-gray-500">
              If you change your mind, you can contact your organization administrator to re-enable
              notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (email) {
    const normalizedEmail = normalizeEmail(email);
    if (userId) {
      // Scoped links are minted only with mailbox proof: the caller presents
      // the token from their email. Without this, knowledge of (userId, email)
      // alone mints a valid token for another tenant account.
      const scoped = token
        ? await resolveUnsubscribeUser({
            db,
            userId,
            email: normalizedEmail,
            token,
            organizationId,
          })
        : null;
      if (!scoped) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
              <div className="text-center text-red-600">
                A valid organization-specific link is required. Use the unsubscribe link from your
                email.
              </div>
            </div>
          </div>
        );
      }
      if (
        scoped &&
        normalizeEmail(scoped.email) === normalizedEmail &&
        scoped.emailNotificationsUnsubscribed
      ) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
              <div className="text-center">
                <h1 className="mb-2 text-2xl font-bold text-gray-900">Already Unsubscribed</h1>
                <p className="text-gray-600">
                  You are already unsubscribed from email notifications and reminders.
                </p>
              </div>
            </div>
          </div>
        );
      }
      const unsubscribeUrl = getUserUnsubscribeUrl({ userId, email, organizationId });
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <div className="text-center">
              <h1 className="mb-4 text-2xl font-bold text-gray-900">
                Unsubscribe from Email Notifications
              </h1>
              <p className="mb-6 text-gray-600">
                Are you sure you want to unsubscribe from email notifications and reminders? You
                will no longer receive policy notifications, task reminders, or other automated
                emails.
              </p>
              <a
                href={unsubscribeUrl}
                className="block w-full rounded-md bg-red-600 px-4 py-2 text-center text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Unsubscribe
              </a>
              <p className="mt-4 text-sm text-gray-500">
                If you change your mind, you can contact your organization administrator to
                re-enable notifications.
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Legacy email-only links must prove mailbox ownership before this
    // page mints or reveals anything: the HMAC is deterministic, so minting
    // a link for an email-only request hands a valid token to anyone who
    // knows the address. Callers without a token use the link from their
    // inbox instead. This also keeps the page from oracle-ing single-account
    // subscription state.
    if (!token || !verifyUnsubscribeToken(email, token)) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <div className="text-center text-red-600">
              A valid unsubscribe link is required. Use the unsubscribe link from your email.
            </div>
          </div>
        </div>
      );
    }

    const matches = await db.user.findMany({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { emailNotificationsUnsubscribed: true },
    });

    if (matches.length === 1 && matches[0]?.emailNotificationsUnsubscribed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-bold text-gray-900">Already Unsubscribed</h1>
              <p className="text-gray-600">
                You are already unsubscribed from email notifications and reminders.
              </p>
            </div>
          </div>
        </div>
      );
    }

    const unsubscribeUrl = getUnsubscribeUrl(email);

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
          <div className="text-center">
            <h1 className="mb-4 text-2xl font-bold text-gray-900">
              Unsubscribe from Email Notifications
            </h1>
            <p className="mb-6 text-gray-600">
              Are you sure you want to unsubscribe from email notifications and reminders? You will
              no longer receive policy notifications, task reminders, or other automated emails.
            </p>
            <a
              href={unsubscribeUrl}
              className="block w-full rounded-md bg-red-600 px-4 py-2 text-center text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              Unsubscribe
            </a>
            <p className="mt-4 text-sm text-gray-500">
              If you change your mind, you can contact your organization administrator to re-enable
              notifications.
            </p>
          </div>
        </div>
      </div>
    );
  }

  redirect('/');
}
