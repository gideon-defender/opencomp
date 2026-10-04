import type { ReasoningUIPart } from 'ai';
import { useEffect, useState } from 'react';
import { useReasoningContext } from '../message';

export function Reasoning({ part, partIndex }: { part: ReasoningUIPart; partIndex: number }) {
  const context = useReasoningContext();
  const isExpanded = context?.expandedReasoningIndex === partIndex;
  const [startTime] = useState(() => Date.now());
  const [duration, setDuration] = useState<number | null>(null);

  const isStreaming = part.state === 'streaming';

  // Snapshot the elapsed time once reasoning finishes (deferred out of the effect body).
  useEffect(() => {
    if (part.state === 'done' && duration === null) {
      // Defer so no setState happens synchronously within the effect.
      queueMicrotask(() => {
        setDuration(Math.round((Date.now() - startTime) / 1000));
      });
    }
  }, [part.state, startTime, duration]);

  // Early return after all hooks
  if (part.state === 'done' && !part.text) {
    return null;
  }

  const getReasoningLabel = () => {
    if (isStreaming) return 'Thinking...';
    if (duration !== null) return `Thought for ${duration}s`;
    return 'Thinking...';
  };

  const handleClick = () => {
    if (context) {
      const newIndex = isExpanded ? null : partIndex;
      context.setExpandedReasoningIndex(newIndex);
    }
  };

  return (
    <div className="text-muted-foreground text-xs leading-6 px-3 py-2 rounded-sm bg-muted border border-border">
      <button
        type="button"
        className="text-left w-full flex items-center gap-2.5 transition-all duration-200 group/btn"
        onClick={handleClick}
      >
        <span
          className={`text-xs truncate block ${isStreaming ? 'thinking-text' : 'text-muted-foreground'}`}
        >
          {getReasoningLabel()}
        </span>
      </button>
    </div>
  );
}
