'use client';

import { cn } from '@gideon-defender/ui/cn';
import { type SVGMotionProps, motion } from 'framer-motion';
import type React from 'react';
import {
  CHECK_PATH,
  LOGO_ACCENT,
  LOGO_TRANSFORM,
  LOGO_VIEW_BOX,
  SHIELD_PATH,
} from './logo-spinner-paths';

interface LogoSpinnerProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
  raceColor?: string;
  isDisabled?: boolean;
}

export const LogoSpinner = ({
  size = 40,
  className,
  raceColor = LOGO_ACCENT,
  isDisabled = false,
  ...props
}: LogoSpinnerProps) => {
  return (
    <div className="flex items-center justify-center">
      <motion.svg
        width={size}
        height={size}
        viewBox={LOGO_VIEW_BOX}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn('', className)}
        {...(isDisabled ? { opacity: 0.5 } : { animate: { scale: [1, 1.1, 1] } })}
        transition={{
          duration: 2,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
        {...(props as SVGMotionProps<SVGSVGElement>)}
      >
        <g transform={LOGO_TRANSFORM}>
          {/* Shield mark - uses currentColor from className. The check is cut
              out of it (evenodd), so CHECK_PATH fills the gap back in. */}
          <path d={SHIELD_PATH} fill="currentColor" fillRule="evenodd" />
          <path d={CHECK_PATH} fill={raceColor} fillRule="evenodd" />

          {!isDisabled && (
            // Racing line running around the shield - uses the raceColor prop
            <motion.path
              d={SHIELD_PATH}
              fill="none"
              stroke={raceColor}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, pathOffset: 0 }}
              animate={{
                pathLength: 0.25,
                pathOffset: [0, 1],
              }}
              transition={{
                pathLength: {
                  duration: 0.01,
                  delay: 0.5,
                },
                pathOffset: {
                  duration: 2.5,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: 'linear',
                },
              }}
            />
          )}
        </g>
      </motion.svg>
    </div>
  );
};
