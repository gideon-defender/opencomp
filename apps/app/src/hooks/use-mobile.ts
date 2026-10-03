import * as React from 'react';

const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  // Initialize from the current viewport so the mount effect below only subscribes.
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === 'undefined' ? undefined : window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
