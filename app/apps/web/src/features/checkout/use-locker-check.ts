import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import {
  deliveryPickupPointCode,
  lockerCheckDue,
  lockerCheckFrom,
  submitLockerCheckDue,
  typedLockerCheck,
  type CheckoutEvent,
  type CheckoutState,
  type DeliverySelection,
  type LockerCheck,
} from './index.web.js';

export type CheckLocker = () => Promise<LockerCheck | null>;

export const useLockerCheck = (state: CheckoutState, dispatch: (event: CheckoutEvent) => void): CheckLocker => {
  const queryClient = useQueryClient();
  const running = useRef(new Map<string, Promise<LockerCheck>>());
  return useCallback(() => {
    const code = lockerCheckDue(state);
    if (code === null) return Promise.resolve(typedLockerCheck(state));
    if (typedLockerCheck(state)?.status !== 'checking') dispatch({ type: 'lockerCheckChanged', check: { status: 'checking', code } });
    const pending = running.current.get(code);
    if (pending !== undefined) return pending;
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

export interface LockerHoldInput {
  state: CheckoutState;
  delivery: DeliverySelection;
  checkLocker: CheckLocker;
  ready: boolean;
  requestKey: string;
  start: () => void;
}

export const useLockerHold = (input: LockerHoldInput): { holding: boolean; submit: () => void } => {
  const [heldCode, setHeldCode] = useState<string | null>(null);
  const latest = useRef<LockerHoldInput | null>(input);
  useEffect(() => {
    latest.current = input;
  });
  useEffect(() => () => {
    latest.current = null;
  }, []);
  const submit = () => {
    if (heldCode !== null || !input.ready) return;
    const code = submitLockerCheckDue(input.state, input.delivery);
    if (code === null) {
      input.start();
      return;
    }
    const requestKey = input.requestKey;
    setHeldCode(code);
    void input.checkLocker().then((check) => {
      setHeldCode(null);
      const current = latest.current;
      if (current === null || check?.status === 'rejected' || !current.ready || current.requestKey !== requestKey ||
        deliveryPickupPointCode(current.delivery) !== code) return;
      current.start();
    });
  };
  return { holding: heldCode !== null, submit };
};
