import type { ReactNode } from 'react';
import { Box, Divider, IconButton, List } from '@mui/material';

import { ColorSchemeSwitcher } from '../../../components/ui/ColorSchemeSwitcher.js';
import { useTranslations } from '../../../i18n/index.js';
import { SheetDrawer, SheetHeader, SheetTitle } from '../../../theme.js';
import {
  MemberAccountActionFailure,
  MemberAccountActionList,
  useMemberAccountActions,
} from '../MemberAccountActions.js';
import { CourseSidebar } from './CourseSidebar.js';
import { MemberSidebar } from './MemberSidebar.js';
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
          <SheetTitle variant="body1" component="p" noWrap>
            {title}
          </SheetTitle>
          <Box sx={{ flex: 1 }} />
          <IconButton sx={{ minHeight: 44, minWidth: 44 }} aria-label={t.shell.closeSheet} onClick={onClose} data-testid={`${testId}-close`}>
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
  avatarUrl,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string;
  avatarUrl: string | null;
}) => {
  const t = useTranslations();
  const account = useMemberAccountActions();
  return (
    <>
      <ShellSheet open={open} onClose={onClose} title={t.shell.menuTitle} testId="member-menu-sheet">
        <MemberSidebar name={name} email={email} avatarUrl={avatarUrl} variant="sheet" />
        <Box sx={{ px: '1rem', pb: '1rem' }}>
          <ColorSchemeSwitcher compact />
        </Box>
        <Box sx={{ px: '0.6rem', pb: '0.75rem' }}>
          <Divider sx={{ mb: '0.5rem' }} />
          <List component="div" disablePadding data-testid="member-menu-account-actions">
            <MemberAccountActionList actions={account.actions.filter((action) => action.key !== 'messages')} onSelect={onClose} surface="sheet" />
          </List>
        </Box>
      </ShellSheet>
      <MemberAccountActionFailure failure={account.failure} onDismiss={account.dismissFailure} />
    </>
  );
};

export const CourseProgramSheet = ({
  open,
  onClose,
  courseId,
  currentLessonId,
  tenantName,
  notFoundFallback = null,
}: {
  open: boolean;
  onClose: () => void;
  courseId: string;
  currentLessonId: string | null;
  tenantName: string;
  notFoundFallback?: ReactNode;
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
        notFoundFallback={notFoundFallback}
      />
    </ShellSheet>
  );
};
