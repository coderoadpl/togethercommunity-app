import { useCallback } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';

import { loginPathWithReturnTo, pathWithSearch, safeReturnTo } from '../../lib/auth-return.js';

export const useRedirectToLogin = () => {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const returnTo = pathWithSearch(location);
  const loginTarget = loginPathWithReturnTo(returnTo);
  return useCallback(
    () => (location.pathname === '/login' ? Promise.resolve() : navigate({ href: loginTarget, replace: true })),
    [location.pathname, loginTarget, navigate],
  );
};

export type LoginLink = { to: '/login'; search?: { returnTo: string } };

export const useLoginLinkWithReturn = (): LoginLink => {
  const returnTo = useRouterState({ select: (state) => safeReturnTo(pathWithSearch(state.location)) });
  return returnTo === null ? { to: '/login' } : { to: '/login', search: { returnTo } };
};
