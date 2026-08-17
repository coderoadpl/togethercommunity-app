import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';

export type ViewerKind = 'pending' | 'anonymous' | 'member';

/**
 * Mirrors the `isMember` split in `MemberShell`, so pages and shell never disagree.
 * A refetch of a `me` that never carried data — the 401 an anonymous visitor gets —
 * resets the query to `pending`, so the last settled answer is kept: otherwise the
 * shell swaps the anonymous tree for the member tree mid-refetch, remounts the page
 * that triggered the refetch, and that remount starts the next one.
 */
export const useViewerKind = (): ViewerKind => {
  const me = useQuery(actions.me);
  const settled = useRef<ViewerKind>('pending');
  if (me.isPending) return settled.current;
  const tenant = me.data?.tenant ?? null;
  settled.current = tenant !== null && (tenant.memberId !== null || tenant.staffRole !== null)
    ? 'member'
    : 'anonymous';
  return settled.current;
};
