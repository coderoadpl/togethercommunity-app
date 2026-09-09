import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';

export const usePostMutations = () => {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.discussionInvalidates()),
      queryClient.invalidateQueries(actions.spacesInvalidates()),
      queryClient.invalidateQueries(actions.memberHomeFeedInvalidates()),
      queryClient.invalidateQueries(actions.memberNavigationInvalidates()),
      queryClient.invalidateQueries(actions.reportsInvalidates()),
      queryClient.invalidateQueries(actions.notificationsInvalidates()),
      queryClient.invalidateQueries(actions.eventsInvalidates()),
    ]);
  };
  const update = useMutation({ ...actions.updatePost, onSettled: invalidate });
  const remove = useMutation({ ...actions.deletePost, onSettled: invalidate });
  const purge = useMutation({ ...actions.purgePost, onSettled: invalidate });
  return { update, remove, purge };
};
