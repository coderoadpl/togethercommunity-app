import { LessonBlockIcon, LessonNavIcon } from '../../theme.js';

export const PreviousLessonIcon = () => (
  <LessonNavIcon aria-hidden data-testid="lesson-nav-icon" viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></LessonNavIcon>
);
export const NextLessonIcon = () => (
  <LessonNavIcon aria-hidden data-testid="lesson-nav-icon" viewBox="0 0 24 24"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" /></LessonNavIcon>
);
export const MarkCompleteIcon = () => (
  <LessonNavIcon aria-hidden data-testid="lesson-nav-icon" viewBox="0 0 24 24"><path d="M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" /></LessonNavIcon>
);

export const LinkIcon = () => (
  <LessonBlockIcon aria-hidden data-testid="link-icon-generic" viewBox="0 0 24 24">
    <path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7h-4a5 5 0 0 0 0 10h4v-1.9h-4A3.1 3.1 0 0 1 3.9 12zm5.1 1h6v-2H9v2zm4-6v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10h-4z" />
  </LessonBlockIcon>
);
