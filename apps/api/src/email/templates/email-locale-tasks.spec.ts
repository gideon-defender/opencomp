import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationBulkFailuresEmail } from './automation-bulk-failures';
import { AutomationFailuresEmail } from './automation-failures';
import { CommentMentionedEmail } from './comment-mentioned';
import { TaskAssigneeChangedEmail } from './task-assignee-changed';
import { TaskBulkAssigneeChangedEmail } from './task-bulk-assignee-changed';
import { TaskBulkStatusChangedEmail } from './task-bulk-status-changed';
import { TaskItemAssignedEmail } from './task-item-assigned';
import { TaskItemMentionedEmail } from './task-item-mentioned';
import { TaskStatusChangedEmail } from './task-status-changed';
import { runLocaleCases, type LocaleCase } from './locale-cases';

const cases: LocaleCase[] = [
  {
    name: 'AutomationBulkFailuresEmail',
    enMarker: 'Automation Failures Summary',
    esMarker: 'Resumen de fallos de automatización',
    build: (locale) =>
      renderToStaticMarkup(
        AutomationBulkFailuresEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          organizationName: 'Acme',
          tasksUrl: 'https://app.example.com/tasks',
          tasks: [
            {
              title: 'Nightly check',
              url: 'https://app.example.com/tasks/1',
              failedCount: 2,
              totalCount: 3,
            },
          ],
          locale,
        }),
      ),
  },
  {
    name: 'AutomationFailuresEmail',
    enMarker: 'Automation Failures',
    esMarker: 'Fallos de automatización',
    build: (locale) =>
      renderToStaticMarkup(
        AutomationFailuresEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Nightly check',
          failedCount: 2,
          totalCount: 3,
          taskStatusChanged: true,
          organizationName: 'Acme',
          taskUrl: 'https://app.example.com/tasks/1',
          locale,
        }),
      ),
  },
  {
    name: 'CommentMentionedEmail',
    enMarker: 'You were mentioned in a comment',
    esMarker: 'Te mencionaron en un comentario',
    build: (locale) =>
      renderToStaticMarkup(
        CommentMentionedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          commentContent: 'please review this',
          mentionedByName: 'Bob',
          entityName: 'Vendor review',
          entityRoutePath: 'vendors',
          entityId: 'v1',
          organizationId: 'o1',
          commentUrl: 'https://app.example.com/c/1',
          locale,
        }),
      ),
  },
  {
    name: 'TaskAssigneeChangedEmail',
    enMarker: 'Task Reassigned',
    esMarker: 'Tarea reasignada',
    build: (locale) =>
      renderToStaticMarkup(
        TaskAssigneeChangedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Collect logs',
          oldAssigneeName: 'Bob',
          newAssigneeName: 'Ada',
          changedByName: 'Cara',
          organizationName: 'Acme',
          taskUrl: 'https://app.example.com/t/1',
          locale,
        }),
      ),
  },
  {
    name: 'TaskBulkAssigneeChangedEmail',
    enMarker: 'Tasks Reassigned',
    esMarker: 'Tareas reasignadas',
    build: (locale) =>
      renderToStaticMarkup(
        TaskBulkAssigneeChangedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskCount: 2,
          newAssigneeName: 'Ada',
          changedByName: 'Cara',
          organizationName: 'Acme',
          tasksUrl: 'https://app.example.com/tasks',
          locale,
        }),
      ),
  },
  {
    name: 'TaskBulkStatusChangedEmail',
    enMarker: 'changed the status of',
    esMarker: 'cambió el estado de',
    build: (locale) =>
      renderToStaticMarkup(
        TaskBulkStatusChangedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskCount: 2,
          newStatus: 'done',
          changedByName: 'Cara',
          organizationName: 'Acme',
          tasksUrl: 'https://app.example.com/tasks',
          locale,
        }),
      ),
  },
  {
    name: 'TaskItemAssignedEmail',
    enMarker: 'assigned you to the task',
    esMarker: 'te asignó la tarea',
    build: (locale) =>
      renderToStaticMarkup(
        TaskItemAssignedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Collect logs',
          assignedByName: 'Cara',
          organizationName: 'Acme',
          taskUrl: 'https://app.example.com/t/1',
          locale,
        }),
      ),
  },
  {
    name: 'TaskItemMentionedEmail',
    enMarker: 'mentioned you in the task',
    esMarker: 'te mencionó en la tarea',
    build: (locale) =>
      renderToStaticMarkup(
        TaskItemMentionedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Collect logs',
          mentionedByName: 'Bob',
          entityName: 'Vendor review',
          entityRoutePath: 'vendors',
          entityId: 'v1',
          organizationId: 'o1',
          taskUrl: 'https://app.example.com/t/1',
          locale,
        }),
      ),
  },
  {
    name: 'TaskStatusChangedEmail',
    enMarker: 'changed the status of task',
    esMarker: 'cambió el estado de la tarea',
    build: (locale) =>
      renderToStaticMarkup(
        TaskStatusChangedEmail({
          toName: 'Ada',
          toEmail: 'ada@example.com',
          taskTitle: 'Collect logs',
          oldStatus: 'todo',
          newStatus: 'done',
          changedByName: 'Cara',
          organizationName: 'Acme',
          taskUrl: 'https://app.example.com/t/1',
          locale,
        }),
      ),
  },
];

describe('email template localization: tasks + automation (en/es)', () => {
  runLocaleCases(cases);
});
