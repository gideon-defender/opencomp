import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotificationPreferences } from './EmailNotificationPreferences';

const { savePreferences } = vi.hoisted(() => ({ savePreferences: vi.fn() }));
vi.mock('../hooks/useEmailPreferences', () => ({
  useEmailPreferences: () => ({ savePreferences }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const preferences = {
  policyNotifications: true,
  taskReminders: false,
  weeklyTaskDigest: true,
  unassignedItemsNotifications: false,
  taskMentions: true,
  taskAssignments: false,
  findingNotifications: true,
};

describe('EmailNotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    savePreferences.mockResolvedValue(undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('displays the effective finding preference and saves a user opt-out', async () => {
    render(
      <EmailNotificationPreferences initialPreferences={preferences} email="admin@example.com" />,
    );
    const finding = screen.getByRole('checkbox', {
      name: 'emailPrefs.items.findingNotifications.label',
    });
    expect(finding).toBeChecked();
    fireEvent.click(finding);
    expect(finding).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'emailPrefs.save' }));
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith({ ...preferences, findingNotifications: false }),
    );
  });

  it('disables and saves every preference, including finding notifications', async () => {
    render(
      <EmailNotificationPreferences
        initialPreferences={{
          ...preferences,
          taskReminders: true,
          unassignedItemsNotifications: true,
          taskAssignments: true,
        }}
        email="admin@example.com"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'emailPrefs.disableAll' }));
    expect(
      screen
        .getAllByRole('checkbox')
        .every((checkbox) => checkbox.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    expect(savePreferences).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'emailPrefs.save' }));
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith({
        policyNotifications: false,
        taskReminders: false,
        weeklyTaskDigest: false,
        unassignedItemsNotifications: false,
        taskMentions: false,
        taskAssignments: false,
        findingNotifications: false,
      }),
    );
  });

  it('locks role-controlled preferences for a read-only member', () => {
    render(
      <EmailNotificationPreferences
        initialPreferences={preferences}
        email="member@example.com"
        isAdminOrOwner={false}
        roleNotifications={{ ...preferences, findingNotifications: false }}
      />,
    );
    const finding = screen.getByRole('checkbox', {
      name: 'emailPrefs.items.findingNotifications.label',
    });
    expect(finding).toBeDisabled();
    expect(finding).not.toBeChecked();
    fireEvent.click(finding);
    expect(finding).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'emailPrefs.save' })).not.toBeInTheDocument();
    expect(savePreferences).not.toHaveBeenCalled();
  });
});
