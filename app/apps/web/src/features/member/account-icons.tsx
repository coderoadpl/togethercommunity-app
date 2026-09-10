import { AccountGlyph as SvgIcon } from '../../theme.js';

const iconViewBox = '0 0 24 24';

export const SignOutIcon = () => (
  <SvgIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  <polyline points="16 17 21 12 16 7" />
  <line x1="21" x2="9" y1="12" y2="12" />
  </SvgIcon>
);

export const StudioIcon = () => (
  <SvgIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden viewBox={iconViewBox} fontSize="small">
    <rect width="7" height="9" x="3" y="3" rx="1" />
  <rect width="7" height="5" x="14" y="3" rx="1" />
  <rect width="7" height="9" x="14" y="12" rx="1" />
  <rect width="7" height="5" x="3" y="16" rx="1" />
  </SvgIcon>
);
