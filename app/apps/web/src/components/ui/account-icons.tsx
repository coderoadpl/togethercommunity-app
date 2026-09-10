import type { ReactNode } from 'react';
import { AccountGlyph } from '../../theme.js';

const Glyph = ({ children }: { children: ReactNode }) => (
  <AccountGlyph aria-hidden="true" focusable="false" viewBox="0 0 24 24" sx={{ width: 20, height: 20, flexShrink: 0 }} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</AccountGlyph>
);

export const UserRoundIcon = () => (<Glyph><circle cx="12" cy="8" r="5" />
  <path d="M20 21a8 8 0 0 0-16 0" /></Glyph>);

export const ShieldCheckIcon = () => (<Glyph><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  <path d="m9 12 2 2 4-4" /></Glyph>);

export const BellIcon = () => (<Glyph><path d="M10.268 21a2 2 0 0 0 3.464 0" />
  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></Glyph>);

export const PlayIcon = () => (<Glyph><polygon points="6 3 20 12 6 21 6 3" /></Glyph>);

export const MailCheckIcon = () => (<Glyph><path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  <path d="m16 19 2 2 4-4" /></Glyph>);

export const LockKeyholeIcon = () => (<Glyph><circle cx="12" cy="16" r="1" />
  <rect x="3" y="10" width="18" height="12" rx="2" />
  <path d="M7 10V7a5 5 0 0 1 10 0v3" /></Glyph>);

export const FingerprintIcon = () => (<Glyph><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
  <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
  <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
  <path d="M2 12a10 10 0 0 1 18-6" />
  <path d="M2 16h.01" />
  <path d="M21.8 16c.2-2 .131-5.354 0-6" />
  <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
  <path d="M8.65 22c.21-.66.45-1.32.57-2" />
  <path d="M9 6.8a6 6 0 0 1 9 5.2v2" /></Glyph>);

export const MonitorIcon = () => (<Glyph><rect width="20" height="14" x="2" y="3" rx="2" />
  <line x1="8" x2="16" y1="21" y2="21" />
  <line x1="12" x2="12" y1="17" y2="21" /></Glyph>);

export const ChevronDownIcon = () => (<Glyph><path d="m6 9 6 6 6-6" /></Glyph>);

export const TriangleAlertIcon = () => (<Glyph><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
  <path d="M12 9v4" />
  <path d="M12 17h.01" /></Glyph>);
