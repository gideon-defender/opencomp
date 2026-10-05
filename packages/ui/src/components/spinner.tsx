import type * as React from 'react';
import { cn } from '../utils';

const SPINNER_BARS = 12;

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  label?: string;
}

function Spinner({ size = 16, label = 'Loading', className, style, ...props }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('loading-parent', className)}
      style={{ height: size, width: size, ...style }}
      {...props}
    >
      <div
        className="loading-wrapper"
        data-visible
        style={{ '--spinner-size': `${size}px` } as React.CSSProperties}
      >
        <div className="spinner">
          {Array.from({ length: SPINNER_BARS }, (_, index) => (
            <div className="loading-bar" key={`spinner-bar-${index}`} aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
}

export { Spinner };
