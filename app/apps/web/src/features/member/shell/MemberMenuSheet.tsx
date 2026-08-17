import type { ReactNode } from 'react';
import { Box, IconButton, Typography } from '@mui/material';

import { useTranslations } from '../../../i18n/index.js';
import { CourseSidebar } from './CourseSidebar.js';
import { MemberSidebar } from './MemberSidebar.js';
import { SheetDrawer, SheetHeader } from './shell-chrome.js';
import { CloseIcon } from './shell-icons.js';

const ShellSheet = ({
  open,
  onClose,
  title,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  testId: string;
  children: ReactNode;
}) => {
  const t = useTranslations();
  return (
    <SheetDrawer anchor="bottom" open={open} onClose={onClose}>
      <Box
        data-testid={testId}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      >
        <SheetHeader>
          <Typography variant="h3" component="p" noWrap>
            {title}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton aria-label={t.shell.closeSheet} onClick={onClose} data-testid={`${testId}-close`}>
            <CloseIcon />
          </IconButton>
        </SheetHeader>
        {children}
      </Box>
    </SheetDrawer>
  );
};

export const MemberMenuSheet = ({
  open,
  onClose,
  name,
  email,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string;
}) => {
  const t = useTranslations();
  return (
    <ShellSheet open={open} onClose={onClose} title={t.shell.menuTitle} testId="member-menu-sheet">
      <MemberSidebar name={name} email={email} variant="sheet" />
    </ShellSheet>
  );
};

export const CourseProgramSheet = ({
  open,
  onClose,
  courseId,
  currentLessonId,
  tenantName,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  currentLessonId: string | null;
  tenantName: string;
}) => {
  const t = useTranslations();
  return (
    <ShellSheet
      open={open}
      onClose={onClose}
      title={t.shell.programTitle}
      testId="course-program-sheet"
    >
      <CourseSidebar
        courseId={courseId}
        currentLessonId={currentLessonId}
        tenantName={tenantName}
        variant="sheet"
      />
    </ShellSheet>
  );
};
