import { SvgIcon } from '@mui/material';

const iconViewBox = '0 0 24 24';

export const SignOutIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
  </SvgIcon>
);

export const StudioIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </SvgIcon>
);
