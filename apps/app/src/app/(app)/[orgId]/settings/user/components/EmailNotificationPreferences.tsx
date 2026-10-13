'use client';

import { Button } from '@gideon-defender/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@gideon-defender/ui/card';
import { Checkbox } from '@gideon-defender/ui/checkbox';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useEmailPreferences } from '../hooks/useEmailPreferences';

const emailPreferencesSchema = z.object({
  policyNotifications: z.boolean(),
  taskReminders: z.boolean(),
  weeklyTaskDigest: z.boolean(),
  unassignedItemsNotifications: z.boolean(),
  taskMentions: z.boolean(),
  taskAssignments: z.boolean(),
  findingNotifications: z.boolean(),
});

type EmailPreferences = z.infer<typeof emailPreferencesSchema>;

interface RoleNotifications {
  policyNotifications: boolean;
  taskReminders: boolean;
  taskAssignments: boolean;
  taskMentions: boolean;
  weeklyTaskDigest: boolean;
  findingNotifications: boolean;
}

interface Props {
  initialPreferences: EmailPreferences;
  email: string;
  isAdminOrOwner?: boolean;
  roleNotifications?: RoleNotifications | null;
}

interface NotificationItem {
  key: keyof EmailPreferences;
  roleKey?: keyof RoleNotifications;
}

const NOTIFICATION_ITEMS: NotificationItem[] = [
  { key: 'policyNotifications', roleKey: 'policyNotifications' },
  { key: 'taskReminders', roleKey: 'taskReminders' },
  { key: 'weeklyTaskDigest', roleKey: 'weeklyTaskDigest' },
  { key: 'unassignedItemsNotifications' },
  { key: 'taskMentions', roleKey: 'taskMentions' },
  { key: 'taskAssignments', roleKey: 'taskAssignments' },
  { key: 'findingNotifications', roleKey: 'findingNotifications' },
];

type SettingsTranslator = ReturnType<typeof useTranslations<'settings'>>;

function itemLabel(t: SettingsTranslator, item: NotificationItem): string {
  switch (item.key) {
    case 'policyNotifications':
      return t('emailPrefs.items.policyNotifications.label');
    case 'taskReminders':
      return t('emailPrefs.items.taskReminders.label');
    case 'weeklyTaskDigest':
      return t('emailPrefs.items.weeklyTaskDigest.label');
    case 'unassignedItemsNotifications':
      return t('emailPrefs.items.unassignedItemsNotifications.label');
    case 'taskMentions':
      return t('emailPrefs.items.taskMentions.label');
    case 'taskAssignments':
      return t('emailPrefs.items.taskAssignments.label');
    case 'findingNotifications':
      return t('emailPrefs.items.findingNotifications.label');
  }
}

function itemDescription(t: SettingsTranslator, item: NotificationItem): string {
  switch (item.key) {
    case 'policyNotifications':
      return t('emailPrefs.items.policyNotifications.description');
    case 'taskReminders':
      return t('emailPrefs.items.taskReminders.description');
    case 'weeklyTaskDigest':
      return t('emailPrefs.items.weeklyTaskDigest.description');
    case 'unassignedItemsNotifications':
      return t('emailPrefs.items.unassignedItemsNotifications.description');
    case 'taskMentions':
      return t('emailPrefs.items.taskMentions.description');
    case 'taskAssignments':
      return t('emailPrefs.items.taskAssignments.description');
    case 'findingNotifications':
      return t('emailPrefs.items.findingNotifications.description');
  }
}

export function EmailNotificationPreferences({
  initialPreferences,
  email,
  isAdminOrOwner = true,
  roleNotifications,
}: Props) {
  const t = useTranslations('settings');
  const { savePreferences } = useEmailPreferences({ initialPreferences });
  const {
    control,
    reset,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<EmailPreferences>({
    resolver: zodResolver(emailPreferencesSchema),
    defaultValues: initialPreferences,
  });
  const preferences = useWatch({ control });

  const handleSelectAll = () => {
    const allEnabled = Object.values(preferences).every((v) => v === true);
    reset({
      policyNotifications: !allEnabled,
      taskReminders: !allEnabled,
      weeklyTaskDigest: !allEnabled,
      unassignedItemsNotifications: !allEnabled,
      taskMentions: !allEnabled,
      taskAssignments: !allEnabled,
      findingNotifications: !allEnabled,
    });
  };

  const handleSave = async (values: EmailPreferences) => {
    if (!isAdminOrOwner) return;
    try {
      await savePreferences(values);
      toast.success(t('emailPrefs.savedToast'));
    } catch {
      toast.error(t('emailPrefs.saveFailedToast'));
    }
  };

  // Check if a notification is locked by role settings (non-admin users only)
  const isLocked = (item: NotificationItem): boolean => {
    if (isAdminOrOwner) return false;
    if (!roleNotifications || !item.roleKey) return false;
    return true; // Non-admin users can't change role-controlled notifications
  };

  const description = isAdminOrOwner
    ? t('emailPrefs.descriptionAdmin', { email })
    : t('emailPrefs.descriptionMember', { email });

  return (
    <form onSubmit={handleSubmit(handleSave)}>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle>{t('emailPrefs.title')}</CardTitle>
            <CardDescription className="break-words">{description}</CardDescription>
          </div>
          {isAdminOrOwner && (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('emailPrefs.saving') : t('emailPrefs.save')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdminOrOwner && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{t('emailPrefs.enableAll')}</p>
                <p className="text-sm text-muted-foreground">{t('emailPrefs.toggleAllHint')}</p>
              </div>
              <Button type="button" onClick={handleSelectAll} variant="outline" size="sm">
                {Object.values(preferences).every((v) => v === true)
                  ? t('emailPrefs.disableAll')
                  : t('emailPrefs.enableAll')}
              </Button>
            </div>
          )}
          <div className="space-y-3">
            {NOTIFICATION_ITEMS.map((item) => {
              const locked = isLocked(item);
              const id = `email-preference-${item.key}`;
              return (
                <label
                  key={item.key}
                  htmlFor={id}
                  className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
                    locked ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-muted/50'
                  }`}
                >
                  <Controller
                    name={item.key}
                    control={control}
                    render={({ field }) => (
                      <Checkbox
                        id={id}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        checked={
                          locked && roleNotifications && item.roleKey
                            ? roleNotifications[item.roleKey]
                            : field.value
                        }
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        disabled={locked}
                        aria-label={itemLabel(t, item)}
                      />
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{itemLabel(t, item)}</span>
                      {locked && <Lock className="h-3.5 w-3.5 shrink-0" />}
                    </div>
                    <p className="text-sm text-muted-foreground">{itemDescription(t, item)}</p>
                    {locked && (
                      <p className="text-xs text-muted-foreground">
                        {t('emailPrefs.managedByAdmin')}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {isAdminOrOwner ? t('emailPrefs.footerAdmin') : t('emailPrefs.footerMember')}
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
