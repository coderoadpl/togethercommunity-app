import { SvgIcon } from '@mui/material';

const iconViewBox = '0 0 24 24';

export const PRODUCTS_ICON_PATH =
  'M20 2H4c-1.1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-.9-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z';

export const COURSES_ICON_PATH =
  'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z';

export const SALES_ICON_PATH =
  'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45C5.09 14.32 5 14.65 5 15c0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03L20.88 5H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z';

export const MEMBERS_ICON_PATH =
  'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z';

export const DashboardIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
  </SvgIcon>
);

export const ProductsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d={PRODUCTS_ICON_PATH} />
  </SvgIcon>
);

export const CoursesIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d={COURSES_ICON_PATH} />
  </SvgIcon>
);

export const LessonsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z" />
  </SvgIcon>
);

export const SalesIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d={SALES_ICON_PATH} />
  </SvgIcon>
);

export const SpacesIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </SvgIcon>
);

export const MembersIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d={MEMBERS_ICON_PATH} />
  </SvgIcon>
);

export const IntegrationsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M16 7V3h-2v4h-4V3H8v4c-1.1 0-2 .9-2 2v5.5L9.5 18v3h5v-3l3.5-3.5V9c0-1.1-.9-2-2-2z" />
  </SvgIcon>
);

export const ReportsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zM6 10V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </SvgIcon>
);

export const CouponsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M22 10V6c0-1.1-.9-2-2-2H4c-1.1 0-1.99.9-1.99 2v4C3.1 10 4 10.9 4 12s-.9 2-1.99 2v4c0 1.1.89 2 1.99 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2s.9-2 2-2zm-9 7.5h-2v-2h2v2zm0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z" />
  </SvgIcon>
);

export const MarketingActivityIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M3.5 18.49 9.5 12.48l4 4L22 6.92 20.59 5.5l-7.09 7.97-4-4L2 16.99z" />
  </SvgIcon>
);

export const MarketingSendsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
  </SvgIcon>
);

export const MarketingCampaignsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39l1.2-1.6-3.2-2.4-1.2 1.61zM20.4 5.6 19.2 4 16 6.4 17.2 8l3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm6.03 5.5H4v-3h6.03l.97-.58v4.16l-.97-.58zM15.5 12c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z" />
  </SvgIcon>
);

export const MarketingConsentsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
  </SvgIcon>
);

export const MarketingDocumentsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M13 7.83c.85-.3 1.53-.98 1.83-1.83H18l-3 7c0 1.66 1.34 3 3 3s3-1.34 3-3l-3-7h2V4h-5.17C14.42 2.83 13.31 2 12 2s-2.42.83-2.83 2H4v2h2l-3 7c0 1.66 1.34 3 3 3s3-1.34 3-3L6 6h3.17c.3.85.98 1.53 1.83 1.83V19H2v2h20v-2h-9V7.83zM6 9.7 7.41 13H4.59L6 9.7zm12 0 1.41 3.3h-2.82L18 9.7z" />
  </SvgIcon>
);

export const MarketingLayoutsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M3 5v14h18V5H3zm8 12H5v-5h6v5zm0-7H5V7h6v3zm8 7h-6V7h6v10z" />
  </SvgIcon>
);

export const SettingsIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
  </SvgIcon>
);

export const MenuIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox}>
    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
  </SvgIcon>
);

export const AccountIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
  </SvgIcon>
);

export const SignOutIcon = () => (
  <SvgIcon aria-hidden viewBox={iconViewBox} fontSize="small">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
  </SvgIcon>
);
