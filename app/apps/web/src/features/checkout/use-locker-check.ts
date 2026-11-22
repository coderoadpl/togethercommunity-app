import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { lockerCheckDue, lockerCheckFrom, typedLockerCheck, type CheckoutEvent, type CheckoutState, type LockerCheck } from './index.web.js';

export type CheckLocker = () => Promise<LockerCheck | null>;

export const useLockerCheck = (state: CheckoutState, dispatch: (event: CheckoutEvent) => void): CheckLocker => {
  const queryClient = useQueryClient();
  const running = useRef(new Map<string, Promise<LockerCheck>>());
  return useCallback(() => {
    const code = lockerCheckDue(state);
    if (code === null) return Promise.resolve(typedLockerCheck(state));
    const pending = running.current.get(code);
    if (pending !== undefined) return pending;
    dispatch({ type: 'lockerCheckChanged', check: { status: 'checking', code } });
    const request = queryClient.fetchQuery(actions.publicParcelLocker(code))
      .then((lookup) => lockerCheckFrom(code, lookup), () => lockerCheckFrom(code, null))
      .then((check) => {
        dispatch({ type: 'lockerCheckChanged', check });
        return check;
      })
      .finally(() => running.current.delete(code));
    running.current.set(code, request);
    return request;
  }, [dispatch, queryClient, state]);
};
