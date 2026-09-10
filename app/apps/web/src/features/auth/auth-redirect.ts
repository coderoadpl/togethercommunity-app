import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';

export const useRedirectSignedInWithTenant = (target = '/') => {
  const me = useQuery(actions.me);
  const navigate = useNavigate();
  const tenant = me.data?.tenant ?? null;
  const hasTenantMembership = tenant !== null && (tenant.staffRole !== null || tenant.memberId !== null);

  useEffect(() => {
    if (hasTenantMembership) void navigate({ href: target });
  }, [hasTenantMembership, navigate, target]);
  return me;
};
