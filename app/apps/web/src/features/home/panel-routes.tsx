import { useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { PanelPage } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { CourseDetail } from './courses/CourseDetail.js';
import { CourseCreatePage, CoursesListPanel } from './courses/CoursesPanel.js';
import { ModuleCreatePage } from './courses/ModuleCreatePage.js';
import { LessonCreatePage, LessonEditPage, LessonsSection } from './courses/LessonsSection.js';
import { IntegrationsPanel } from './integrations/IntegrationsPanel.js';
import { MemberDetail } from './members/MemberDetail.js';
import { MembersPanel } from './members/MembersPanel.js';
import { ReportsPanel } from './reports/ReportsPanel.js';
import { ProductCreatePage } from './products/ProductCreatePage.js';
import { ProductEditorPage } from './products/ProductEditorPage.js';
import { ProductsPanel } from './products/ProductsPanel.js';
import { SettingsPanel } from './settings/SettingsPanel.js';
import { SalesPanel } from './sales/SalesPanel.js';
import { OrderDetailPage } from './sales/OrderDetailPage.js';
import {
  CouponCreatePage,
  CouponDetailPage,
  CouponsPanel,
} from './sales/CouponsPanel.js';
import { SpacesPanel } from './spaces/SpacesPanel.js';
import { SpaceCreatePage } from './spaces/SpaceCreatePage.js';
import { SpaceEditPage } from './spaces/SpaceEditPage.js';

export const PanelProductsRoute = () => <ProductsPanel />;
export const PanelProductCreateRoute = () => <ProductCreatePage />;

export const PanelProductDetailRoute = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const productId = params.productId ?? '';
  const products = useQuery(actions.products);

  if (products.isPending) {
    return <PanelPage title={t.sections.products} state={{ kind: 'loading', label: t.products.loading }} />;
  }
  if (products.isError) {
    return <PanelPage title={t.sections.products} state={{ kind: 'error', message: localizeError(products.error, t), retry: { label: t.common.retry, onRetry: () => void products.refetch() } }} />;
  }
  const product = products.data.products.find((entry) => entry.id === productId);
  if (!product) return <Navigate to="/panel/products" />;
  return <ProductEditorPage product={product} />;
};

export const PanelCoursesRoute = () => <CoursesListPanel />;
export const PanelCourseCreateRoute = () => <CourseCreatePage />;

export const PanelModuleCreateRoute = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const courseId = params.courseId ?? '';
  const courses = useQuery(actions.courses);

  if (courses.isPending) {
    return <PanelPage title={t.courses.newModule} state={{ kind: 'loading', label: t.courses.loadingCourse }} />;
  }
  if (courses.isError) {
    return <PanelPage title={t.courses.newModule} state={{ kind: 'error', message: localizeError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} />;
  }

  const course = courses.data.courses.find((entry) => entry.id === courseId);
  if (!course) return <Navigate to="/panel/courses" />;

  return <ModuleCreatePage courseId={course.id} courseName={course.name} />;
};

export const PanelCourseDetailRoute = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const courseId = params.courseId ?? '';
  const courses = useQuery(actions.courses);

  const back = () => void navigate({ to: '/panel/courses' });

  if (courses.isPending) return <PanelPage title={t.sections.courses} state={{ kind: 'loading', label: t.courses.loadingCourse }} />;
  if (courses.isError) return <PanelPage title={t.sections.courses} state={{ kind: 'error', message: localizeError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} />;

  const course = courses.data.courses.find((entry) => entry.id === courseId);
  if (!course) return <Navigate to="/panel/courses" />;

  return <CourseDetail course={course} onBack={back} />;
};

export const PanelLessonsRoute = () => <LessonsSection />;
export const PanelLessonCreateRoute = () => <LessonCreatePage />;

export const PanelLessonEditRoute = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const lessonId = params.lessonId ?? '';
  const lessons = useQuery(actions.lessons);

  if (lessons.isPending) return <PanelPage title={t.sections.lessons} backTo={{ label: t.lessons.allLessons, href: '/panel/lessons' }} state={{ kind: 'loading', label: t.lessons.loading }} />;
  if (lessons.isError) return <PanelPage title={t.sections.lessons} backTo={{ label: t.lessons.allLessons, href: '/panel/lessons' }} state={{ kind: 'error', message: localizeError(lessons.error, t), retry: { label: t.common.retry, onRetry: () => void lessons.refetch() } }} />;

  const lesson = lessons.data.lessons.find((entry) => entry.id === lessonId);
  if (!lesson) return <Navigate to="/panel/lessons" />;

  return <LessonEditPage lesson={lesson} />;
};

export const PanelMembersRoute = () => <MembersPanel />;
export const PanelReportsRoute = () => <ReportsPanel />;

export const PanelMemberDetailRoute = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const memberId = params.memberId ?? '';
  const members = useQuery(actions.members);

  const back = () => void navigate({ to: '/panel/members' });

  if (members.isPending) return <PanelPage title={t.sections.members} state={{ kind: 'loading', label: t.members.loading }} />;
  if (members.isError) return <PanelPage title={t.sections.members} state={{ kind: 'error', message: localizeError(members.error, t), retry: { label: t.common.retry, onRetry: () => void members.refetch() } }} />;

  const member = members.data.members.find((entry) => entry.id === memberId);
  if (!member) return <Navigate to="/panel/members" />;

  return <MemberDetail member={member} onBack={back} />;
};

export const PanelSpacesRoute = () => <SpacesPanel />;
export const PanelSpaceCreateRoute = () => <SpaceCreatePage />;

export const PanelSpaceDetailRoute = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const spaceId = params.spaceId ?? '';
  const spaces = useQuery(actions.staffSpaces);

  if (spaces.isPending) {
    return <PanelPage title={t.sections.spaces} state={{ kind: 'loading', label: t.spacesPanel.loading }} />;
  }
  if (spaces.isError) {
    return <PanelPage title={t.sections.spaces} state={{ kind: 'error', message: localizeError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }} />;
  }
  const space = spaces.data.spaces.find((entry) => entry.id === spaceId);
  if (!space) return <Navigate to="/panel/spaces" />;
  return <SpaceEditPage space={space} />;
};

export const PanelIntegrationsRoute = () => {
  return <IntegrationsPanel />;
};

export const PanelSalesRoute = () => <SalesPanel />;
export const PanelOrderDetailRoute = () => {
  const params = useParams({ strict: false });
  return <OrderDetailPage orderId={params.orderId ?? ''} />;
};
export const PanelCouponsRoute = () => <CouponsPanel />;
export const PanelCouponCreateRoute = () => <CouponCreatePage />;
export const PanelCouponDetailRoute = () => {
  const params = useParams({ strict: false });
  return <CouponDetailPage couponId={params.couponId ?? ''} />;
};

export const PanelSettingsRoute = () => <SettingsPanel />;
