import { OutlineEmptyStateIcon as EmptyStateIcon, OutlineStatTileIcon as StatTileIcon } from '../../theme.js';

export const StatLessonsIcon = () => (
  <StatTileIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-testid="stat-icon-lessons" viewBox="0 0 24 24">
    <path d="M3 12h.01" />
  <path d="M3 18h.01" />
  <path d="M3 6h.01" />
  <path d="M8 12h13" />
  <path d="M8 18h13" />
  <path d="M8 6h13" />
  </StatTileIcon>
);

export const StatClockIcon = () => (
  <StatTileIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-testid="stat-icon-duration" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" />
  <polyline points="12 6 12 12 16 14" />
  </StatTileIcon>
);

export const EmptyLibraryIcon = () => (
  <EmptyStateIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-testid="empty-library-icon" viewBox="0 0 24 24">
    <path d="M12 7v14" />
  <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </EmptyStateIcon>
);

export const EmptyCourseIcon = () => (
  <EmptyStateIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-testid="empty-course-icon" viewBox="0 0 24 24">
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
  <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
  <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </EmptyStateIcon>
);

export const EmptyLessonIcon = () => (
  <EmptyStateIcon stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden data-testid="empty-lesson-icon" viewBox="0 0 24 24">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  <path d="M10 9H8" />
  <path d="M16 13H8" />
  <path d="M16 17H8" />
  </EmptyStateIcon>
);
