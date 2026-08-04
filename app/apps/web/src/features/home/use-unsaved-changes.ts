import { useCallback, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';

export const useUnsavedChanges = (dirty: boolean, message: string) => {
  const allowRef = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useBlocker({
    shouldBlockFn: () => {
      if (allowRef.current || !dirtyRef.current) return false;
      return !window.confirm(message);
    },
    enableBeforeUnload: () => dirtyRef.current && !allowRef.current,
  });

  return useCallback(() => {
    allowRef.current = true;
  }, []);
};
