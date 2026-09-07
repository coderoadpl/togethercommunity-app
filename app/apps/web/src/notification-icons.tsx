import { SvgIcon } from '@mui/material';

import type { Notification } from '#core/domain/index.js';

const PATHS: Record<Notification['kind'], string> = {
  'thread-reply': 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  'lesson-question':
    'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm2.07-7.75-.9.92c-.5.51-.87.99-.97 1.83h-2.2v-.5c0-.62.28-1.2.72-1.64l1.24-1.26c.37-.36.6-.86.6-1.4a2 2 0 1 0-4 0H8.5a4 4 0 0 1 8 0c0 .88-.36 1.68-.93 2.25z',
  'space-post':
    'M20 10V8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4zm-6 4h-4v-4h4v4z',
  'dm-message':
    'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
  'dm-report': 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
  'space-event':
    'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zM7 12h5v5H7z',
  'tenant-domain-verified':
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8z',
  'tenant-domain-error': 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
};

const COLORS: Partial<Record<Notification['kind'], 'success' | 'error'>> = {
  'tenant-domain-verified': 'success',
  'tenant-domain-error': 'error',
};

export const NotificationKindIcon = ({ kind }: { kind: Notification['kind'] }) => (
  <SvgIcon aria-hidden viewBox="0 0 24 24" color={COLORS[kind] ?? 'inherit'}>
    <path d={PATHS[kind]} />
  </SvgIcon>
);
