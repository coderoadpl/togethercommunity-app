import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { PanelPage } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { DashboardPanel } from './DashboardPanel.js';
import { CourseDetail } from './courses/CourseDetail.js';
import { CoursesListPanel } from './courses/CoursesPanel.js';
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

  if (courses.isPending) return <PanelPage title={t.sections.courses} state={{ kind: 'loading', label: t.courses.loadingCourse }} />;
  if (courses.isError) return <PanelPage title={t.sections.courses} state={{ kind: 'error', message: localizeError(courses.error, t) }} />;

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

  if (members.isPending) return <PanelPage title={t.sections.members} state={{ kind: 'loading', label: t.members.loading }} />;
  if (members.isError) return <PanelPage title={t.sections.members} state={{ kind: 'error', message: localizeError(members.error, t) }} />;

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
    <PanelPage
      title={t.sections.sales}
      state={{ kind: 'empty', title: t.sections.comingSoon }}
    />
  );
};

export const PanelSettingsRoute = () => <SettingsPanel />;
