import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { ImpersonationView } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { useAnonymousSessionFallback } from './use-anonymous-session-fallback.js';

export type ViewerKind = 'pending' | 'anonymous' | 'member';

export const useImpersonation = (): ImpersonationView | null =>
  useQuery(actions.me).data?.impersonation ?? null;

export const useCanOpenStudio = (): boolean => {
  const tenant = useQuery(actions.me).data?.tenant ?? null;
  return tenant !== null && tenant.staffRole !== null;
};

/**
 * Mirrors the `isMember` split in `MemberShell`, so pages and shell never disagree.
 * A refetch of a `me` that never carried data — the 401 an anonymous visitor gets —
 * resets the query to `pending`, so the last settled answer is kept: otherwise the
 * shell swaps the anonymous tree for the member tree mid-refetch, remounts the page
 * that triggered the refetch, and that remount starts the next one.
 */
export const useViewerKind = (): ViewerKind => {
  const me = useQuery(actions.me);
  const queryClient = useQueryClient();
  const subscribe = useCallback((notify: () => void) => queryClient.getQueryCache().subscribe(notify), [queryClient]);
  const rejected = useSyncExternalStore(subscribe, () => {
    if (queryClient.getQueryData(actions.me.queryKey) === undefined) return false;
    return queryClient.getQueryCache().getAll().some((query) => {
      const root = query.queryKey[0];
      if (typeof root === 'string' && root.startsWith('public-')) return false;
      // A lesson's own 401 must keep its sign-in redirect.
      if (root === 'student' && query.queryKey[1] === 'lesson' && (query.queryKey.length === 3 || query.queryKey[3] === 'edition')) return false;
      return query.state.error instanceof ApiError && query.state.error.appError.code === 'unauthorized';
    });
  });
  const expired = useAnonymousSessionFallback(rejected || me.error instanceof ApiError && me.error.appError.code === 'unauthorized');
  const settled = useRef<ViewerKind>('pending');
  if (expired) {
    settled.current = 'anonymous';
    return 'anonymous';
  }
  if (me.isPending) return settled.current;
  const tenant = me.data?.tenant ?? null;
  settled.current = tenant !== null && (tenant.memberId !== null || tenant.staffRole !== null)
    ? 'member'
    : 'anonymous';
  return settled.current;
};
