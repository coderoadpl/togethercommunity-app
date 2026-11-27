import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { forgetLoginIdentifier } from '../../../lib/login-identifier.js';
import { clearListLayoutCopies } from '../../../theme-mode.js';

export const useVisitorSignOut = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      forgetLoginIdentifier();
      clearListLayoutCopies();
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });
};
