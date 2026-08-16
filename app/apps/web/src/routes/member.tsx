import { useParams } from '@tanstack/react-router';

import { CoursePage } from '../features/member/CoursePage.js';
import { CourseStructurePage } from '../features/member/CourseStructurePage.js';
import { LessonPlayerPage } from '../features/member/LessonPlayerPage.js';
import { MemberAccountPage } from '../features/member/MemberAccountPage.js';
import { MyCoursesPage } from '../features/member/MyCoursesPage.js';
import { MyProductsPage } from '../features/member/MyProductsPage.js';
import { SpaceFeedPage } from '../features/member/SpaceFeedPage.js';
import { SpaceThreadPage } from '../features/member/SpaceThreadPage.js';
import { MemberShell } from '../features/member/shell/MemberShell.js';
import { SpacesListPage } from '../features/member/SpacesListPage.js';

export const MemberShellRoute = () => <MemberShell />;

export const MyCoursesRoute = () => <MyCoursesPage />;

export const MemberAccountRoute = () => <MemberAccountPage />;

export const MyProductsRoute = () => <MyProductsPage />;

export const CourseRoute = () => {
  const params = useParams({ strict: false });
  return <CoursePage productId={params.productId ?? ''} />;
};

export const CourseStructureRoute = () => {
  const params = useParams({ strict: false });
  return <CourseStructurePage courseId={params.courseId ?? ''} />;
};

export const LessonPlayerRoute = () => {
  const params = useParams({ strict: false });
  return <LessonPlayerPage courseId={params.courseId ?? ''} lessonId={params.lessonId ?? ''} />;
};

export const CommunityRoute = () => <SpacesListPage />;

export const SpaceFeedRoute = () => {
  const params = useParams({ strict: false });
  return <SpaceFeedPage spaceId={params.spaceId ?? ''} />;
};

export const SpaceThreadRoute = () => {
  const params = useParams({ strict: false });
  return <SpaceThreadPage spaceId={params.spaceId ?? ''} postId={params.postId ?? ''} />;
};
