import { Link as MuiLink } from '@mui/material';
import { Link } from '@tanstack/react-router';

import type { BreadcrumbItem } from '../../components/layout/index.js';
import type { Messages } from '../../i18n/index.js';
import { anonHomePath } from './shell/member-nav.js';

export const anonCrumbs = (t: Messages, ...trail: BreadcrumbItem[]): BreadcrumbItem[] => [
  {
    label: t.shell.start,
    link: (
      <MuiLink component={Link} to={anonHomePath()}>
        {t.shell.start}
      </MuiLink>
    ),
  },
  ...trail,
];
