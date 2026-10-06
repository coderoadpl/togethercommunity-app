import { useEffect, useState } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { studentLessonOutputSchema } from '#core/contract/index.js';

import { actions } from '../../api.js';

export const useAnonymousSessionFallback = (anonymous: boolean, readableQueryKey?: QueryKey): boolean => {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);
  const readableHash = readableQueryKey === undefined ? undefined : hashKey(readableQueryKey);

  useEffect(() => {
    if (!anonymous || expired) return;
    const identity = queryClient.getQueryCache().find({ ...actions.me, exact: true });
    if (identity?.state.data === undefined) return;
    setExpired(true);
    queryClient.removeQueries({
      predicate: (query) => {
        const root = query.queryKey[0];
        if (query.queryHash === readableHash || typeof root === 'string' && root.startsWith('public-')) return false;
        if (root === 'student' && query.queryKey[1] === 'lesson' && query.queryKey.length === 3) {
          const lesson = studentLessonOutputSchema.safeParse(query.state.data);
          if (query.state.data === undefined || lesson.success && !lesson.data.authenticated) return false;
        }
        return true;
      },
    });
    // Removing an observed query leaves its current result intact until its observers are notified.
    identity.reset();
  }, [anonymous, expired, queryClient, readableHash]);

  return anonymous || expired;
};
