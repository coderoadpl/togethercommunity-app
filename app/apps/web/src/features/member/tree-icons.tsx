import {
  AccessLockIcon,
  AccessLockOpenIcon,
  CompletionCheckIcon,
  CompletionPartialIcon,
  TreeCaret,
} from '../../theme.js';

export const LockClosed = () => (
  <AccessLockIcon aria-hidden data-testid="lock-closed" viewBox="0 0 24 24">
    <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 1 1 6 0v3H9z" />
  </AccessLockIcon>
);

export const LockOpen = () => (
  <AccessLockOpenIcon aria-hidden data-testid="lock-open" viewBox="0 0 24 24">
    <path d="M12 13a2 2 0 0 1 1 3.73V19a1 1 0 0 1-2 0v-2.27A2 2 0 0 1 12 13zm6-4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h9V6a3 3 0 0 0-5.83-1 1 1 0 0 1-1.9-.62A5 5 0 0 1 17 6v3h1z" />
  </AccessLockOpenIcon>
);

export const CompletionFull = () => (
  <CompletionCheckIcon aria-hidden data-testid="completion-full" viewBox="0 0 24 24">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </CompletionCheckIcon>
);

export const CompletionPartial = () => (
  <CompletionPartialIcon aria-hidden data-testid="completion-partial" viewBox="0 0 24 24">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM7 11h10v2H7z" />
  </CompletionPartialIcon>
);

export const Caret = ({ open }: { open: boolean }) => (
  <TreeCaret aria-hidden viewBox="0 0 24 24">
    {open ? <path d="M7 10l5 5 5-5z" /> : <path d="M10 7l5 5-5 5z" />}
  </TreeCaret>
);
