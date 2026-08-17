import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';

export type ViewerKind = 'pending' | 'anonymous' | 'member';

/** Mirrors the `isMember` split in `MemberShell`, so pages and shell never disagree. */
export const useViewerKind = (): ViewerKind => {
  const me = useQuery(actions.me);
  if (me.isPending) return 'pending';
  const tenant = me.data?.tenant ?? null;
  return tenant !== null && (tenant.memberId !== null || tenant.staffRole !== null)
    ? 'member'
    : 'anonymous';
};
