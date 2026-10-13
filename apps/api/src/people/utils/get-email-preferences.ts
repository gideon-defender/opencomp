import { db } from '@db';
import { resolveEmailPreferences } from '@gideon-defender/email';
import { NotFoundException } from '@nestjs/common';

export async function getUserEmailPreferences({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailPreferences: true, emailNotificationsUnsubscribed: true },
  });
  if (!user) throw new NotFoundException('User not found');
  const unsubscribed = user.emailNotificationsUnsubscribed ?? false;
  return {
    email: userEmail,
    preferences: resolveEmailPreferences({
      preferences: user.emailPreferences,
      unsubscribed,
    }),
    unsubscribed,
  };
}
