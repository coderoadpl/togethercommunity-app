import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';

export const useRedirectSignedInWithTenant = (target = '/', enabled = true) => {
  const me = useQuery(actions.me);
  const navigate = useNavigate();
  const tenant = me.data?.tenant ?? null;
  const hasTenantMembership = tenant !== null && (tenant.staffRole !== null || tenant.memberId !== null);

  useEffect(() => {
    if (enabled && hasTenantMembership) void navigate({ href: target });
  }, [enabled, hasTenantMembership, navigate, target]);
  return me;
};
