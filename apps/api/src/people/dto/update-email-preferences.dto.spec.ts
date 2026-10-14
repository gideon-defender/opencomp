import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateEmailPreferencesDto } from './update-email-preferences.dto';

const preferences = {
  policyNotifications: false,
  taskReminders: false,
  weeklyTaskDigest: false,
  unassignedItemsNotifications: false,
  taskMentions: false,
  taskAssignments: false,
};
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const metadata = { type: 'body' as const, metatype: UpdateEmailPreferencesDto };

describe('email preference request compatibility', () => {
  it('accepts the six-field request from the retained MCP client', async () => {
    await expect(
      pipe.transform({ preferences }, metadata),
    ).resolves.toMatchObject({ preferences });
  });
  it('accepts an explicit finding notification choice', async () => {
    await expect(
      pipe.transform(
        { preferences: { ...preferences, findingNotifications: false } },
        metadata,
      ),
    ).resolves.toMatchObject({ preferences: { findingNotifications: false } });
  });
  it.each([null, 'false', 1])(
    'rejects an invalid finding notification value: %s',
    async (value) => {
      await expect(
        pipe.transform(
          { preferences: { ...preferences, findingNotifications: value } },
          metadata,
        ),
      ).rejects.toThrow(BadRequestException);
    },
  );
});
