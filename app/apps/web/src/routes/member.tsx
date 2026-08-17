import { useParams, useSearch } from '@tanstack/react-router';

import { CoursePage } from '../features/member/CoursePage.js';
import { EventPage } from '../features/member/events/EventPage.js';
import { CourseStructurePage } from '../features/member/CourseStructurePage.js';
import { LessonPlayerPage } from '../features/member/LessonPlayerPage.js';
import { MemberAccountPage } from '../features/member/MemberAccountPage.js';
import { ConversationPage } from '../features/member/messages/ConversationPage.js';
import { MessagesListPage } from '../features/member/messages/MessagesListPage.js';
import { MyCoursesPage } from '../features/member/MyCoursesPage.js';
import { MyProductsPage } from '../features/member/MyProductsPage.js';
import { NotificationsPage } from '../features/member/NotificationsPage.js';
import { SpaceFeedPage } from '../features/member/SpaceFeedPage.js';
import { SpaceThreadPage } from '../features/member/SpaceThreadPage.js';
import { SearchPage } from '../features/member/SearchPage.js';
import { MemberShell } from '../features/member/shell/MemberShell.js';
import { SpacesListPage } from '../features/member/SpacesListPage.js';
import { StartPage } from '../features/member/StartPage.js';

export const MemberShellRoute = () => <MemberShell />;

export const StartRoute = () => <StartPage />;

export const SearchRoute = () => <SearchPage />;

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
  const { thread } = useSearch({ strict: false });
  return (
    <LessonPlayerPage
      courseId={params.courseId ?? ''}
      lessonId={params.lessonId ?? ''}
      threadRootPostId={thread ?? null}
    />
  );
};

export const NotificationsRoute = () => <NotificationsPage />;

export const MessagesRoute = () => <MessagesListPage />;

export const ConversationRoute = () => {
  const params = useParams({ strict: false });
  return <ConversationPage conversationId={params.conversationId ?? ''} />;
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

export const CommunityEventRoute = () => {
  const params = useParams({ strict: false });
  return <EventPage spaceId={params.spaceId ?? ''} eventId={params.eventId ?? ''} />;
};
