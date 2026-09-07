import type { ReactNode } from 'react';
import { Link as MuiLink, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { useTranslations } from '../../../i18n/index.js';
import { ShellBreadcrumbs } from '../../../theme.js';
import { locateLesson } from '../lesson-nav.js';

export const CourseBreadcrumbs = ({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) => {
  const t = useTranslations();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const structure = useQuery(actions.courseStructure(courseId));
  const tree = structure.data?.structure;
  if (tree === undefined) return null;

  const location = locateLesson(tree, lessonId);
  if (location.row === null) return null;

  const ancestors = compact
    ? []
    : [location.module, location.chapter].flatMap((node) => (node === null ? [] : [node.name]));
  const crumbs: ReactNode[] = [
    <MuiLink
      key="course"
      component={Link}
      to={`/my/courses/${encodeURIComponent(courseId)}`}
      color="inherit"
    >
      {location.courseName}
    </MuiLink>,
    ...ancestors.map((name) => (
      <Typography key={name} variant="body2">
        {name}
      </Typography>
    )),
    <Typography key="current" variant="body2">
      {location.row.name}
    </Typography>,
  ];

  return (
    <ShellBreadcrumbs aria-label={t.common.breadcrumbs} data-testid="member-breadcrumbs">
      {crumbs}
    </ShellBreadcrumbs>
  );
};
