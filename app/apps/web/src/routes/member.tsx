import { useParams } from '@tanstack/react-router';

import { CoursePage } from '../features/member/CoursePage.js';
import { CourseStructurePage } from '../features/member/CourseStructurePage.js';
import { LessonPlayerPage } from '../features/member/LessonPlayerPage.js';
import { MyCoursesPage } from '../features/member/MyCoursesPage.js';
import { MyProductsPage } from '../features/member/MyProductsPage.js';

export const MyCoursesRoute = () => <MyCoursesPage />;

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
