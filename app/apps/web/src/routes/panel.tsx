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
  PanelSpacesRoute,
  PanelSpaceCreateRoute,
  PanelSpaceDetailRoute,
} from '../features/home/panel-routes.js';
export {
  CampaignCreatePage,
  CampaignDetailPage,
  CampaignsPanel,
} from '../features/home/marketing/CampaignsPanel.js';
export {
  ConsentCreatePage,
  ConsentDetailPage,
  ConsentsPanel,
} from '../features/home/marketing/ConsentsPanel.js';
export {
  DocumentCreatePage,
  DocumentDetailPage,
  DocumentsPanel,
} from '../features/home/marketing/DocumentsPanel.js';
export {
  LayoutCreatePage,
  LayoutDetailPage,
  LayoutsPanel,
} from '../features/home/marketing/LayoutsPanel.js';
export { MarketingSettingsPanel } from '../features/home/marketing/MarketingSettingsPanel.js';
export {
  SchedulerActivityDetailPage,
  SchedulerActivityPanel,
} from '../features/home/marketing/SchedulerActivityPanel.js';
export { SendDetailPage, SendsPanel, validateSendsSearch } from '../features/home/marketing/SendsPanel.js';

/**
 * The onboarding checklist is composed here, not inside the home feature:
 * features are import-islands, and this single line is the feature's only
 * mount — delete `features/onboarding/` and this import to drop it wholesale.
 */
export const PanelIndexRoute = () => <DashboardPanel topContent={<OnboardingChecklist />} />;
