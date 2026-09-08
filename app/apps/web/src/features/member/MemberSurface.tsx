import type { ComponentProps } from 'react';

import { TenantSocialLinks } from '../../branding.js';
import { MemberPage } from '../../components/layout/index.js';
import { useTranslations } from '../../i18n/index.js';

type Props = Omit<ComponentProps<typeof MemberPage>, 'breadcrumbLabel'> & {
  hideSocialLinks?: boolean;
};

export const MemberSurface = ({ hideSocialLinks = false, ...props }: Props) => {
  const t = useTranslations();
  return (
    <MemberPage
      {...props}
      breadcrumbLabel={t.common.breadcrumbs}
      children={(
        <>
          {props.children}
          {hideSocialLinks ? null : <TenantSocialLinks />}
        </>
      )}
    />
  );
};
