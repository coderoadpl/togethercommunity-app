import { Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { DashboardPanel } from './DashboardPanel.js';
import { CourseDetail } from './courses/CourseDetail.js';
import { CoursesListPanel } from './courses/CoursesPanel.js';
import { MutationError } from './courses/feedback.js';
import { LessonsSection } from './courses/LessonsSection.js';
import { IntegrationsPanel } from './integrations/IntegrationsPanel.js';
import { MemberDetail } from './members/MemberDetail.js';
import { MembersPanel } from './members/MembersPanel.js';
import { usePanelContext } from './panel-context.js';
import { ProductsPanel } from './products/ProductsPanel.js';
import { SettingsPanel } from './settings/SettingsPanel.js';

export const PanelIndexRoute = () => <DashboardPanel />;

export const PanelProductsRoute = () => <ProductsPanel />;

export const PanelCoursesRoute = () => <CoursesListPanel />;

export const PanelCourseDetailRoute = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const courseId = params.courseId ?? '';
  const courses = useQuery(actions.courses);

  const back = () => void navigate({ to: '/panel/courses' });

  if (courses.isPending) return <Typography variant="body1">{t.courses.loadingCourse}</Typography>;
  if (courses.isError) return <MutationError error={courses.error} />;

  const course = courses.data.courses.find((entry) => entry.id === courseId);
  if (!course) return <Navigate to="/panel/courses" />;

  return <CourseDetail course={course} onBack={back} />;
};

export const PanelLessonsRoute = () => <LessonsSection />;

export const PanelMembersRoute = () => <MembersPanel />;

export const PanelMemberDetailRoute = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const memberId = params.memberId ?? '';
  const members = useQuery(actions.members);

  const back = () => void navigate({ to: '/panel/members' });

  if (members.isPending) return <Typography variant="body1">{t.members.loading}</Typography>;
  if (members.isError) return <MutationError error={members.error} />;

  const member = members.data.members.find((entry) => entry.id === memberId);
  if (!member) return <Navigate to="/panel/members" />;

  return <MemberDetail member={member} onBack={back} />;
};

export const PanelIntegrationsRoute = () => {
  const { tenant } = usePanelContext();
  return <IntegrationsPanel tenantId={tenant.id} />;
};

export const PanelSalesRoute = () => {
  const t = useTranslations();
  return (
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Typography variant="h2" component="h2">
        {t.sections.sales}
      </Typography>
      <Typography variant="body1" sx={{ mt: '1rem' }}>
        {t.sections.comingSoon}
      </Typography>
    </Paper>
  );
};

export const PanelSettingsRoute = () => <SettingsPanel />;
