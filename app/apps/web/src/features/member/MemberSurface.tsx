import type { ComponentProps } from 'react';

import { TenantSocialLinks } from '../../branding.js';
import { MemberPage } from '../../components/layout/index.js';
import { useTranslations } from '../../i18n/index.js';

type Props = Omit<ComponentProps<typeof MemberPage>, 'breadcrumbLabel'>;

export const MemberSurface = (props: Props) => {
  const t = useTranslations();
  return (
    <MemberPage
      {...props}
      breadcrumbLabel={t.common.breadcrumbs}
      children={(
        <>
          {props.children}
          <TenantSocialLinks />
        </>
      )}
    />
  );
};
