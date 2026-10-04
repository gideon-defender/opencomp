'use client';

import type { Member, User } from '@db';
import { cn } from '@gideon-defender/ui/cn';
import { Input } from '@gideon-defender/ui/input';
import { Skeleton } from '@gideon-defender/ui/skeleton';
import { Search } from 'lucide-react';
import { useQueryState } from 'nuqs';

type Props = {
  isEmpty?: boolean;
  assignees: (Member & { user: User })[];
};

export function FilterToolbar({ isEmpty }: Props) {
  const [search, setSearch] = useQueryState('search', {
    shallow: false,
    history: 'push',
    parse: (value) => value || null,
  });

  if (isEmpty) {
    return (
      <div className="pointer-events-none mb-4 flex flex-col gap-4 opacity-20 blur-[7px] md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 md:max-w-sm">
          <Skeleton className={cn('h-10', isEmpty && 'animate-none')} />
        </div>

        <div className="hidden gap-2 md:flex md:flex-row md:items-center">
          <Skeleton className={cn('h-10 w-[200px]', isEmpty && 'animate-none')} />
          <Skeleton className={cn('h-10 w-[200px]', isEmpty && 'animate-none')} />
          <Skeleton className={cn('h-9 w-[120px]', isEmpty && 'animate-none')} />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-row items-center justify-between gap-2">
      <div className="relative flex-1 sm:max-w-sm">
        <Search className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
        <Input
          placeholder={'Search...'}
          className="pl-8"
          value={search || ''}
          onChange={(e) => setSearch(e.target.value || null)}
        />
      </div>
    </div>
  );
}
