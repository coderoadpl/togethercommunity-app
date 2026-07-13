import { LessonBlockIcon, LockedStateIcon } from '../../theme.js';

export const CodeIcon = () => (
  <LessonBlockIcon aria-hidden data-testid="link-icon-code" viewBox="0 0 24 24">
    <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
  </LessonBlockIcon>
);

export const LinkIcon = () => (
  <LessonBlockIcon aria-hidden data-testid="link-icon-generic" viewBox="0 0 24 24">
    <path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7h-4a5 5 0 0 0 0 10h4v-1.9h-4A3.1 3.1 0 0 1 3.9 12zm5.1 1h6v-2H9v2zm4-6v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10h-4z" />
  </LessonBlockIcon>
);

export const LockedState = () => (
  <LockedStateIcon aria-hidden data-testid="locked-state-icon" viewBox="0 0 24 24">
    <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 1 1 6 0v3H9z" />
  </LockedStateIcon>
);
