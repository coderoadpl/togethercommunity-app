import { SvgIcon } from '@mui/material';
import { styled } from '@mui/material/styles';

const LineIcon = styled(SvgIcon)({
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export const PasskeyOutlineIcon = () => (
  <LineIcon aria-hidden viewBox="0 0 24 24">
    <path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
    <path d="M4 21v-1a6 6 0 0 1 6-6h1" />
    <path d="M17.5 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM19.5 16.5 22 19M22 19l-1.5 1.5" />
  </LineIcon>
);

export const CoursesOutlineIcon = () => (
  <LineIcon aria-hidden viewBox="0 0 24 24">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </LineIcon>
);

export const CommunityOutlineIcon = () => (
  <LineIcon aria-hidden viewBox="0 0 24 24">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </LineIcon>
);

export const ShowPasswordIcon = () => (
  <LineIcon aria-hidden viewBox="0 0 24 24">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </LineIcon>
);

export const HidePasswordIcon = () => (
  <LineIcon aria-hidden viewBox="0 0 24 24">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </LineIcon>
);
