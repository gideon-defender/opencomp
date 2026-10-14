import { db, type Prisma } from '@db';
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';

const storedPreferenceSchema = z.object({
  findingNotifications: z.boolean().optional(),
});

export async function updateUserEmailPreferences({
  userId,
  preferences,
}: {
  userId: string;
  preferences: Record<string, boolean | undefined>;
}) {
  const write = ({
    client,
    findingNotifications,
  }: {
    client: Pick<Prisma.TransactionClient, 'user'>;
    findingNotifications: boolean;
  }) => {
    const next = { ...preferences, findingNotifications };
    return client.user.update({
      where: { id: userId },
      data: {
        emailPreferences: next,
        emailNotificationsUnsubscribed: Object.values(next).every(
          (value) => value === false,
        ),
      },
    });
  };
  if (preferences.findingNotifications !== undefined) {
    await write({
      client: db,
      findingNotifications: preferences.findingNotifications,
    });
    return { success: true };
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { emailPreferences: true, emailNotificationsUnsubscribed: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const stored = storedPreferenceSchema.safeParse(user.emailPreferences);
    const findingNotifications = stored.success
      ? stored.data.findingNotifications
      : undefined;
    await write({
      client: tx,
      findingNotifications:
        findingNotifications ?? !user.emailNotificationsUnsubscribed,
    });
  });
  return { success: true };
}
