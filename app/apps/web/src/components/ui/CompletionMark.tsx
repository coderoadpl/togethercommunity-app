import { CompletionMarkIcon } from '../../theme.js';

export const CompletionMark = ({
  label,
  size = 'sm',
}: {
  label: string;
  size?: 'sm' | 'md';
}) => (
  <CompletionMarkIcon
    markSize={size}
    titleAccess={label}
    data-testid="completion-mark"
    viewBox="0 0 24 24"
  >
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </CompletionMarkIcon>
);
