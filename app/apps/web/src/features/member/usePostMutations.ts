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
    ]);
  };
  const update = useMutation({ ...actions.updatePost, onSettled: invalidate });
  const remove = useMutation({ ...actions.deletePost, onSettled: invalidate });
  return { update, remove };
};
