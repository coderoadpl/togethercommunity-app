import { useCallback, useEffect, useEffectEvent, useId, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';

const ENTRY_KEY = 'checkoutOverlay';

const entryOf = (state: object): unknown => Reflect.get(state, ENTRY_KEY);

export const useHistoryEntry = (onBack: () => void) => {
  const router = useRouter();
  const prefix = useId();
  const opened = useRef(0);
  const entry = useRef<string | null>(null);
  const wentBack = useEffectEvent(() => onBack());

  useEffect(() => router.history.subscribe(({ location }) => {
    if (entry.current === null || entryOf(location.state) === entry.current) return;
    entry.current = null;
    wentBack();
  }), [router]);

  const enter = useCallback(() => {
    opened.current += 1;
    const id = `${prefix}${opened.current}`;
    entry.current = id;
    const { href, state } = router.history.location;
    router.history.push(href, { ...state, [ENTRY_KEY]: id });
  }, [prefix, router]);

  const leave = useCallback(() => {
    const id = entry.current;
    entry.current = null;
    if (id !== null && entryOf(router.history.location.state) === id) router.history.back();
  }, [router]);

  return { enter, leave };
};
