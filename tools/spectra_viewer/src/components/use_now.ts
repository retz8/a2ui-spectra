import {useEffect, useState} from 'react';

/** How often an in-flight call's duration and bar move, in milliseconds. */
export const TICK_MS = 100;

/** The present, moving every tick while `running`, so an in-flight call's duration counts up. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
