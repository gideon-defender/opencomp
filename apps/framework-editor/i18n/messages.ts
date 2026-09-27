import enAuth from '../messages/en/auth.json';
import enDialogs from '../messages/en/dialogs.json';
import enEditableCell from '../messages/en/editableCell.json';
import enFrameworks from '../messages/en/frameworks.json';
import enShell from '../messages/en/shell.json';
import enTasks from '../messages/en/tasks.json';
import enToasts from '../messages/en/toasts.json';
import enToolbar from '../messages/en/toolbar.json';
import enUnsavedChanges from '../messages/en/unsavedChanges.json';
import enValidation from '../messages/en/validation.json';
import esAuth from '../messages/es/auth.json';
import esDialogs from '../messages/es/dialogs.json';
import esEditableCell from '../messages/es/editableCell.json';
import esFrameworks from '../messages/es/frameworks.json';
import esShell from '../messages/es/shell.json';
import esTasks from '../messages/es/tasks.json';
import esToasts from '../messages/es/toasts.json';
import esToolbar from '../messages/es/toolbar.json';
import esUnsavedChanges from '../messages/es/unsavedChanges.json';
import esValidation from '../messages/es/validation.json';
import { routing } from './routing';

export const enMessages = {
  auth: enAuth,
  dialogs: enDialogs,
  editableCell: enEditableCell,
  frameworks: enFrameworks,
  shell: enShell,
  tasks: enTasks,
  toasts: enToasts,
  toolbar: enToolbar,
  unsavedChanges: enUnsavedChanges,
  validation: enValidation,
};

export const esMessages = {
  auth: esAuth,
  dialogs: esDialogs,
  editableCell: esEditableCell,
  frameworks: esFrameworks,
  shell: esShell,
  tasks: esTasks,
  toasts: esToasts,
  toolbar: esToolbar,
  unsavedChanges: esUnsavedChanges,
  validation: esValidation,
};

export type AppMessages = typeof enMessages;
export type AppLocale = (typeof routing)['locales'][number];

const allMessages: Record<AppLocale, AppMessages> = {
  en: enMessages,
  es: esMessages,
};

export function getMessagesForLocale(locale: string): AppMessages {
  if (locale === 'es') return allMessages.es;
  return allMessages.en;
}
