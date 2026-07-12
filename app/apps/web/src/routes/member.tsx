import { useParams } from '@tanstack/react-router';

import { CoursePage } from '../features/member/CoursePage.js';
import { MyProductsPage } from '../features/member/MyProductsPage.js';

export const MyProductsRoute = () => <MyProductsPage />;

export const CourseRoute = () => {
  const params = useParams({ strict: false });
  return <CoursePage productId={params.productId ?? ''} />;
};
