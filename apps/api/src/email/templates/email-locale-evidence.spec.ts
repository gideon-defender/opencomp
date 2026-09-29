import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceAccessRequestSubmittedEmail } from './evidence-access-request-submitted';
import { EvidenceBulkReviewRequestedEmail } from './evidence-bulk-review-requested';
import { EvidenceReviewRequestedEmail } from './evidence-review-requested';
import { FindingNotificationEmail } from './finding-notification';
import { HipaaTrainingCompletedEmail } from './hipaa-training-completed';
import { TrainingCompletedEmail } from './training-completed';
import { UnassignedItemsNotificationEmail } from './unassigned-items-notification';
import { runLocaleCases, type LocaleCase } from './locale-cases';

const completedAt = new Date('2026-12-31T00:00:00Z');

const cases: LocaleCase[] = [
  {
    name: 'EvidenceAccessRequestSubmittedEmail',
    enMarker: 'submitted an access request in',
    esMarker: 'envió una solicitud de acceso en',
    build: (locale) =>
      renderToStaticMarkup(
        EvidenceAccessRequestSubmittedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          organizationName: 'Acme',
          requesterName: 'Bob',
          accountsNeeded: 'prod db',
          permissionsNeeded: 'read',
          reasonForRequest: 'audit',
          reviewUrl: 'https://app.example.com/review',
          locale,
        }),
      ),
  },
  {
    name: 'EvidenceBulkReviewRequestedEmail',
    enMarker: 'for your review in',
    esMarker: 'para tu revisión en',
    build: (locale) =>
      renderToStaticMarkup(
        EvidenceBulkReviewRequestedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskCount: 2,
          submittedByName: 'Bob',
          organizationName: 'Acme',
          tasksUrl: 'https://app.example.com/tasks',
          tasks: [{ title: 'Task one', url: 'https://app.example.com/t/1' }],
          locale,
        }),
      ),
  },
  {
    name: 'EvidenceReviewRequestedEmail',
    enMarker: 'has submitted evidence for',
    esMarker: 'ha enviado evidencia de',
    build: (locale) =>
      renderToStaticMarkup(
        EvidenceReviewRequestedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Collect logs',
          submittedByName: 'Bob',
          organizationName: 'Acme',
          taskUrl: 'https://app.example.com/t/1',
          locale,
        }),
      ),
  },
  {
    name: 'FindingNotificationEmail',
    enMarker: 'Finding Details',
    esMarker: 'Datos del hallazgo',
    build: (locale) =>
      renderToStaticMarkup(
        FindingNotificationEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          heading: 'New finding',
          message: 'Something needs attention.',
          taskTitle: 'Collect logs',
          organizationName: 'Acme',
          findingType: 'Manual',
          findingContent: 'Missing evidence file.',
          findingUrl: 'https://app.example.com/f/1',
          locale,
        }),
      ),
  },
  {
    name: 'HipaaTrainingCompletedEmail',
    enMarker: 'HIPAA Training Complete!',
    esMarker: '¡Formación HIPAA completada!',
    build: (locale) =>
      renderToStaticMarkup(
        HipaaTrainingCompletedEmail({
          email: 'ada@example.com',
          userName: 'Ada',
          organizationName: 'Acme',
          completedAt,
          locale,
        }),
      ),
  },
  {
    name: 'TrainingCompletedEmail',
    enMarker: 'Training Complete!',
    esMarker: '¡Formación completada!',
    build: (locale) =>
      renderToStaticMarkup(
        TrainingCompletedEmail({
          email: 'ada@example.com',
          userName: 'Ada',
          organizationName: 'Acme',
          completedAt,
          locale,
        }),
      ),
  },
  {
    name: 'UnassignedItemsNotificationEmail',
    enMarker: 'Items Require Reassignment',
    esMarker: 'elementos requieren reasignación',
    build: (locale) =>
      renderToStaticMarkup(
        UnassignedItemsNotificationEmail({
          userName: 'Ada',
          organizationName: 'Acme',
          organizationId: 'o1',
          removedMemberName: 'Bob',
          unassignedItems: [
            { type: 'task', id: 't1', name: 'Task one' },
            { type: 'policy', id: 'p1', name: 'Policy one' },
          ],
          locale,
        }),
      ),
  },
];

describe('email template localization: evidence + misc (en/es)', () => {
  runLocaleCases(cases);
});
