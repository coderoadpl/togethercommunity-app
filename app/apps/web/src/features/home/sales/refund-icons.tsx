import type { ReactNode } from 'react';

import { RefundStrokeIcon } from '../../../theme.js';

const StrokeIcon = ({ children }: { children: ReactNode }) => (
  <RefundStrokeIcon aria-hidden viewBox="0 0 24 24" fontSize="small">
    {children}
  </RefundStrokeIcon>
);

export const ChevronIcon = () => (
  <StrokeIcon>
    <path d="m9 18 6-6-6-6" />
  </StrokeIcon>
);

export const RefundIcon = () => (
  <StrokeIcon>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </StrokeIcon>
);

export const MailIcon = () => (
  <StrokeIcon>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </StrokeIcon>
);

export const AccessIcon = () => (
  <StrokeIcon>
    <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
    <path d="M4 17a3 3 0 0 1 3-3h11" />
  </StrokeIcon>
);

export const PackageIcon = () => (
  <StrokeIcon>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </StrokeIcon>
);

export const TruckIcon = () => (
  <StrokeIcon>
    <path d="M2 5h12v11H2z" />
    <path d="M14 9h4l4 4v3h-8" />
    <circle cx="6.5" cy="18" r="2" />
    <circle cx="17.5" cy="18" r="2" />
  </StrokeIcon>
);

export const StatusIcon = () => (
  <StrokeIcon>
    <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
  </StrokeIcon>
);

export const TestModeIcon = () => (
  <StrokeIcon>
    <path d="M9 3h6M10 3v6l-5.6 9.7A1.5 1.5 0 0 0 5.7 21h12.6a1.5 1.5 0 0 0 1.3-2.3L14 9V3" />
  </StrokeIcon>
);

export const LockIcon = () => (
  <StrokeIcon>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </StrokeIcon>
);

export const InvoiceIcon = () => (
  <StrokeIcon>
    <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
    <path d="M9 7h6M9 11h6M9 15h4" />
  </StrokeIcon>
);

export const ClockIcon = () => (
  <StrokeIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </StrokeIcon>
);

export const CheckCircleIcon = () => (
  <StrokeIcon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </StrokeIcon>
);

export const WarningIcon = () => (
  <StrokeIcon>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </StrokeIcon>
);
