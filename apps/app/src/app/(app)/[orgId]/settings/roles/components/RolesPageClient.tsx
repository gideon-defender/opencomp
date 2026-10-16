'use client';

import { Button } from '@gideon-defender/ui/button';
import { useRoles } from '../hooks/useRoles';
import Loading from '../loading';
import type { CustomRole } from './RolesTable';
import { RolesTable } from './RolesTable';
import { SystemRolesTable } from './SystemRoles';

interface RolesPageClientProps {
  initialData: CustomRole[];
}

export function RolesPageClient({ initialData }: RolesPageClientProps) {
  const { roles, isLoading, error, mutate } = useRoles({ initialData });

  function handleRetry() {
    void mutate();
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="system-roles-title" className="flex flex-col gap-4">
        <div>
          <h2 id="system-roles-title" className="text-lg font-semibold">
            System Roles
          </h2>
          <p className="text-sm text-muted-foreground">
            Built-in roles with predefined permissions. These cannot be modified.
          </p>
        </div>
        <SystemRolesTable />
      </section>

      <section aria-labelledby="custom-roles-title" className="flex flex-col gap-4">
        <div>
          <h2 id="custom-roles-title" className="text-lg font-semibold">
            Custom Roles
          </h2>
          <p className="text-sm text-muted-foreground">
            Create custom roles with specific permissions tailored to your organization. Assignments
            are managed in Gideon.
          </p>
        </div>
        {error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 px-4 py-6"
          >
            <p className="text-sm font-medium">Could not load roles.</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Something went wrong.'} Your roles may
              exist — this view failed to fetch them.
            </p>
            <Button type="button" variant="link" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <Loading />
        ) : (
          <RolesTable roles={roles} />
        )}
      </section>
    </div>
  );
}
