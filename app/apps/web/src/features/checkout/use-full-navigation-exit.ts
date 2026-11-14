import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';

export const useFullNavigationExit = () => {
  const router = useRouter();
  const armed = useRef(false);
  useEffect(() => {
    const unblock = router.history.block({
      blockerFn: ({ currentLocation, nextLocation, action }) => {
        if (!armed.current || (currentLocation.pathname === nextLocation.pathname &&
          currentLocation.search === nextLocation.search)) return false;
        // Keep POP blocked until unload so the router cannot roll back and cancel the document navigation.
        return new Promise<boolean>(() => {
          if (action === 'BACK' || action === 'FORWARD' || action === 'GO') {
            // POP already changed the URL; assigning it with a fragment would keep this document alive.
            window.location.reload();
          } else {
            window.location.assign(nextLocation.href);
          }
        });
      },
      enableBeforeUnload: false,
    });
    return () => {
      // An injected vendor script cannot be unloaded, so its navigation guard must survive the component.
      if (!armed.current) unblock();
    };
  }, [router]);
  return useCallback(() => {
    armed.current = true;
  }, []);
};
