'use client';

import { useEffect, useState } from 'react';

interface ResearchActivityProps {
  toolName: 'exaSearch' | 'firecrawl';
  input: unknown;
  state: string;
  output?: {
    results?: unknown[];
    summary?: string;
  };
  isAnimating: boolean;
}

export function ResearchActivity({ toolName, state, output }: ResearchActivityProps) {
  const isComplete = state === 'output-available';
  const isError = state === 'output-error';
  const [startTime] = useState(() => Date.now());
  const [duration, setDuration] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Snapshot the elapsed time once research finishes (deferred out of the effect body).
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
      return duration ? `Research failed after ${duration}s` : 'Research encountered an issue';
    }

    if (toolName === 'exaSearch') {
      if (isComplete && duration !== null) {
        const results = output?.results || [];
        if (results.length === 0) {
          return `Searched for ${duration}s - No results found`;
        }
        return `Searched for ${duration}s - Found relevant documentation`;
      }
      return 'Searching...';
    }

    if (isComplete && duration !== null) {
      return `Researched for ${duration}s - Successfully gathered information`;
    }
    return 'Researching...';
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
