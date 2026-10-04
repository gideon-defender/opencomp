'use client';

import { type Task } from '@db';
import { TaskBody } from './TaskBody';

interface TaskMainContentProps {
  task: Task & { fileUrls?: string[] };
  showComments?: boolean;
}

export function TaskMainContent({ task }: TaskMainContentProps) {
  return <TaskBody taskId={task.id} />;
}
