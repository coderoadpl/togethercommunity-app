import { DashboardPanel } from '../features/home/DashboardPanel.js';
import { OnboardingChecklist } from '../features/onboarding/index.js';

export { PanelLayout } from '../features/home/PanelLayout.js';
export {
  PanelCourseDetailRoute,
  PanelCourseCreateRoute,
  PanelModuleCreateRoute,
  PanelCoursesRoute,
  PanelIntegrationsRoute,
  PanelLessonsRoute,
  PanelLessonCreateRoute,
  PanelLessonEditRoute,
  PanelMemberDetailRoute,
  PanelMembersRoute,
  PanelProductsRoute,
  PanelProductCreateRoute,
  PanelProductDetailRoute,
  PanelSalesRoute,
  PanelSettingsRoute,
} from '../features/home/panel-routes.js';

/**
 * The onboarding checklist is composed here, not inside the home feature:
 * features are import-islands, and this single line is the feature's only
 * mount — delete `features/onboarding/` and this import to drop it wholesale.
 */
export const PanelIndexRoute = () => <DashboardPanel topContent={<OnboardingChecklist />} />;
