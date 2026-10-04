'use client';

import { useEffect, useState } from 'react';

interface FileWritingActivityProps {
  input: unknown;
  state: string;
  output?: {
    summary?: string;
  };
  isAnimating: boolean;
}

export function FileWritingActivity({ state, output }: FileWritingActivityProps) {
  const isComplete = state === 'output-available';
  const isError = state === 'output-error';
  const [startTime] = useState(() => Date.now());
  const [duration, setDuration] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Snapshot the elapsed time once writing finishes (deferred out of the effect body).
  useEffect(() => {
    if ((isComplete || isError) && duration === null) {
      // Defer so no setState happens synchronously within the effect.
      queueMicrotask(() => {
        setDuration(Math.round((Date.now() - startTime) / 1000));
      });
    }
  }, [isComplete, isError, startTime, duration]);

  const getTitle = () => {
    if (isError) {
      return duration ? `Failed to save after ${duration}s` : 'Failed to save automation';
    }

    if (isComplete && duration !== null) {
      return `Saved in ${duration}s`;
    }
    return 'Creating automation...';
  };

  return (
    <div className="py-0.5">
      <button
        type="button"
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        <span>{getTitle()}</span>
      </button>
      {isExpanded && (isComplete || isError) && output?.summary && (
        <div className="mt-1 ml-3 text-xs text-muted-foreground/80 leading-relaxed">
          {output.summary}
        </div>
      )}
    </div>
  );
}
