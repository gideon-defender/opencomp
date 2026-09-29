import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage, resolveLocale } from '../lib/locale';
import { AllPolicyNotificationEmail } from './all-policy-notification';
import { ChangeEmailConfirmationEmail } from './change-email-confirmation';
import { InviteEmail } from './invite';
import { InvitePortalEmail } from './invite-portal';
import { MagicLinkEmail } from './magic-link';
import { WelcomeEmail } from './marketing/welcome';
import { OTPVerificationEmail } from './otp';
import { PolicyAcknowledgmentDigestEmail } from './policy-acknowledgment-digest';
import { PolicyNotificationEmail } from './policy-notification';
import { TaskReminderEmail } from './reminders/task-reminder';
import { TaskStatusNotificationEmail } from './reminders/task-status-notification';
import { WeeklyTaskDigestEmail } from './reminders/weekly-task-digest';
import { TrainingCompletedEmail } from './training-completed';
import { UnassignedItemsNotificationEmail } from './unassigned-items-notification';
import { VerifyEmail } from './verify-email';

const baseProps = {
  email: 'user@example.com',
  userName: 'User',
  organizationName: 'Acme',
  organizationId: 'org_123',
} as const;

// Each entry probes one template with a Spanish key phrase expected only in
// the `locale="es"` render and an English phrase expected only in default.
const cases = [
  {
    name: 'invite',
    en: () => <InviteEmail organizationName="Acme" inviteLink="https://x.test/i" />,
    es: () => (
      <InviteEmail organizationName="Acme" inviteLink="https://x.test/i" locale="es" />
    ),
    esPhrase: 'Te han invitado a unirte a OpenComp',
    enPhrase: 'You&#x27;ve been invited to join OpenComp',
  },
  {
    name: 'invite-portal',
    en: () => <InvitePortalEmail email="user@example.com" inviteLink="https://x.test/i" />,
    es: () => (
      <InvitePortalEmail email="user@example.com" inviteLink="https://x.test/i" locale="es" />
    ),
    esPhrase: 'Te han invitado al Portal de OpenComp',
    enPhrase: 'You&#x27;ve been invited to the OpenComp Portal',
  },
  {
    name: 'magic-link',
    en: () => <MagicLinkEmail email="user@example.com" url="https://x.test/m" />,
    es: () => <MagicLinkEmail email="user@example.com" url="https://x.test/m" locale="es" />,
    esPhrase: 'Tu enlace de acceso para OpenComp',
    enPhrase: 'Your login link for OpenComp',
  },
  {
    name: 'verify-email',
    en: () => <VerifyEmail email="user@example.com" url="https://x.test/v" />,
    es: () => <VerifyEmail email="user@example.com" url="https://x.test/v" locale="es" />,
    esPhrase: 'Verifica tu correo electrónico',
    enPhrase: 'Verify your email for OpenComp',
  },
  {
    name: 'otp',
    en: () => <OTPVerificationEmail email="user@example.com" otp="123456" />,
    es: () => <OTPVerificationEmail email="user@example.com" otp="123456" locale="es" />,
    esPhrase: 'Tu contraseña de un solo uso',
    enPhrase: 'Your one-time password for OpenComp',
  },
  {
    name: 'change-email-confirmation',
    en: () => (
      <ChangeEmailConfirmationEmail
        currentEmail="old@example.com"
        newEmail="new@example.com"
        url="https://x.test/v"
      />
    ),
    es: () => (
      <ChangeEmailConfirmationEmail
        currentEmail="old@example.com"
        newEmail="new@example.com"
        url="https://x.test/v"
        locale="es"
      />
    ),
    esPhrase: 'Confirma tu cambio de correo electrónico',
    enPhrase: 'Confirm your email change',
  },
  {
    name: 'welcome',
    en: () => <WelcomeEmail name="User" />,
    es: () => <WelcomeEmail name="User" locale="es" />,
    esPhrase: '¡Bienvenido a OpenComp!',
    enPhrase: 'Welcome to OpenComp!',
  },
  {
    name: 'policy-notification',
    en: () => (
      <PolicyNotificationEmail
        {...baseProps}
        policyName="Acceptable Use"
        notificationType="new"
      />
    ),
    es: () => (
      <PolicyNotificationEmail
        {...baseProps}
        policyName="Acceptable Use"
        notificationType="new"
        locale="es"
      />
    ),
    esPhrase: 'Revisa y acepta esta política',
    enPhrase: 'Please review and accept this policy',
  },
  {
    name: 'all-policy-notification',
    en: () => <AllPolicyNotificationEmail {...baseProps} />,
    es: () => <AllPolicyNotificationEmail {...baseProps} locale="es" />,
    esPhrase: 'Revisa y acepta las políticas',
    enPhrase: 'Please review and accept the policies',
  },
  {
    name: 'policy-acknowledgment-digest',
    en: () => (
      <PolicyAcknowledgmentDigestEmail
        email="user@example.com"
        userName="User"
        orgs={[
          {
            id: 'org_123',
            name: 'Acme',
            policies: [{ id: 'p1', name: 'Uso aceptable', url: 'https://x.test/p1' }],
          },
        ]}
      />
    ),
    es: () => (
      <PolicyAcknowledgmentDigestEmail
        email="user@example.com"
        userName="User"
        orgs={[
          {
            id: 'org_123',
            name: 'Acme',
            policies: [{ id: 'p1', name: 'Uso aceptable', url: 'https://x.test/p1' }],
          },
        ]}
        locale="es"
      />
    ),
    esPhrase: 'Tienes 1 política para revisar',
    enPhrase: 'You have 1 policy to review',
  },
  {
    name: 'training-completed',
    en: () => (
      <TrainingCompletedEmail {...baseProps} completedAt={new Date('2026-04-13')} />
    ),
    es: () => (
      <TrainingCompletedEmail {...baseProps} completedAt={new Date('2026-04-13')} locale="es" />
    ),
    esPhrase: '¡Formación completada!',
    enPhrase: 'Training Complete!',
  },
  {
    name: 'unassigned-items-notification',
    en: () => (
      <UnassignedItemsNotificationEmail
        userName="User"
        organizationName="Acme"
        organizationId="org_123"
        removedMemberName="Former"
        unassignedItems={[{ type: 'task', id: 't1', name: 'Task' }]}
      />
    ),
    es: () => (
      <UnassignedItemsNotificationEmail
        userName="User"
        organizationName="Acme"
        organizationId="org_123"
        removedMemberName="Former"
        unassignedItems={[{ type: 'task', id: 't1', name: 'Task' }]}
        locale="es"
      />
    ),
    esPhrase: 'requieren reasignación',
    enPhrase: 'Items Require Reassignment',
  },
  {
    name: 'task-reminder',
    en: () => (
      <TaskReminderEmail email="user@example.com" name="User" dueDate="2026-04-20" recordId="r1" />
    ),
    es: () => (
      <TaskReminderEmail
        email="user@example.com"
        name="User"
        dueDate="2026-04-20"
        recordId="r1"
        locale="es"
      />
    ),
    esPhrase: 'Recordatorio de tarea',
    enPhrase: 'Task Reminder',
  },
  {
    name: 'task-status-notification',
    en: () => (
      <TaskStatusNotificationEmail
        email="user@example.com"
        userName="User"
        taskName="Task"
        taskStatus="todo"
        organizationName="Acme"
        taskUrl="https://x.test/t1"
      />
    ),
    es: () => (
      <TaskStatusNotificationEmail
        email="user@example.com"
        userName="User"
        taskName="Task"
        taskStatus="todo"
        organizationName="Acme"
        taskUrl="https://x.test/t1"
        locale="es"
      />
    ),
    esPhrase: 'Necesita revisión',
    enPhrase: 'Needs Review',
  },
  {
    name: 'weekly-task-digest',
    en: () => (
      <WeeklyTaskDigestEmail {...baseProps} tasks={[{ id: 't1', title: 'Task one' }]} />
    ),
    es: () => (
      <WeeklyTaskDigestEmail
        {...baseProps}
        tasks={[{ id: 't1', title: 'Task one' }]}
        locale="es"
      />
    ),
    esPhrase: 'Tienes 1 tarea pendiente',
    enPhrase: 'You have 1 pending task',
  },
];

describe('email locale support', () => {
  for (const { name, en, es, esPhrase, enPhrase } of cases) {
    it(`${name}: es render has Spanish copy, lang="es", no English`, async () => {
      const html = await render(es());
      expect(html).toContain('lang="es"');
      expect(html).toContain(esPhrase);
      expect(html).not.toContain(enPhrase);
    });

    it(`${name}: default render stays English with lang="en"`, async () => {
      const html = await render(en());
      expect(html).toContain('lang="en"');
      expect(html).toContain(enPhrase);
      expect(html).not.toContain(esPhrase);
    });
  }

  it('resolveLocale normalizes input with en fallback', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('localeFromAcceptLanguage picks supported language', () => {
    expect(localeFromAcceptLanguage('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('fr-FR,en;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage(undefined)).toBe('en');
  });

  it('localeFromAcceptLanguage honors q-values over header order', () => {
    expect(localeFromAcceptLanguage('en;q=0.1, es;q=0.9')).toBe('es');
    expect(localeFromAcceptLanguage('es;q=0, en;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage('fr;q=0.9, es;q=0.2')).toBe('es');
  });

  it('localeFromAcceptLanguage honors explicit en at its q-position', () => {
    expect(localeFromAcceptLanguage('en, es')).toBe('en');
    expect(localeFromAcceptLanguage('en;q=1, es;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('en-US, es;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage('es;q=0.5, en;q=0.5')).toBe('es');
  });

  it('localeFromAcceptLanguage handles malformed ranges', () => {
    expect(localeFromAcceptLanguage('es;q=abc')).toBe('es');
    expect(localeFromAcceptLanguage('*;q=0.8, es;q=0.5')).toBe('es');
    expect(localeFromAcceptLanguage('*')).toBe('en');
  });
});
