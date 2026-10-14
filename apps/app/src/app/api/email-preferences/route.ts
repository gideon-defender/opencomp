import { db, normalizeEmail } from '@db/server';
import { resolveUnsubscribeUser, verifyUnsubscribeToken } from '@gideon-defender/email';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const updatePreferencesSchema = z.object({
  email: z.string().email(),
  token: z.string(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  preferences: z.object({
    policyNotifications: z.boolean(),
    taskReminders: z.boolean(),
    weeklyTaskDigest: z.boolean(),
    unassignedItemsNotifications: z.boolean(),
    taskMentions: z.boolean(),
    taskAssignments: z.boolean(),
    findingNotifications: z.boolean(),
  }),
});

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = updatePreferencesSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const { email, token, userId, organizationId, preferences } = parsed.data;
    const normalizedEmail = normalizeEmail(email);

    let targetUserId: string;
    if (userId) {
      const scoped = await resolveUnsubscribeUser({
        db,
        userId,
        email: normalizedEmail,
        token,
        organizationId,
      });
      if (!scoped) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 403 });
      }
      targetUserId = scoped.id;
    } else {
      // Pass the raw address: the verifier also accepts the pre-scoping
      // (raw) token form so in-flight links keep working.
      if (!verifyUnsubscribeToken(email, token)) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 403 });
      }
      const matches = await db.user.findMany({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      if (matches.length === 0) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }
      if (matches.length > 1) {
        return NextResponse.json(
          {
            success: false,
            error:
              'This email is used by several organizations — use your organization-specific link',
          },
          { status: 409 },
        );
      }
      targetUserId = matches[0].id;
    }

    const allUnsubscribed = Object.values(preferences).every((v) => v === false);

    await db.user.update({
      where: { id: targetUserId },
      data: {
        emailPreferences: preferences,
        emailNotificationsUnsubscribed: allUnsubscribed,
      },
    });

    return NextResponse.json({ success: true, data: preferences });
  } catch (error) {
    console.error('Error updating unsubscribe preferences:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update preferences' },
      { status: 500 },
    );
  }
}
