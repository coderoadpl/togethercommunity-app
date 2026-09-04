import { DashboardPanel } from '../features/home/DashboardPanel.js';
import { usePanelContext } from '../features/home/panel-context.js';
import { StudioChecklistDock } from '../features/onboarding/index.js';

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
  PanelMarketingSettingsRedirectRoute,
  PanelMemberDetailRoute,
  PanelMembersRoute,
  PanelReportsRoute,
  PanelProductsRoute,
  PanelProductCreateRoute,
  PanelProductDetailRoute,
  PanelSalesRoute,
  PanelOrderDetailRoute,
  PanelCouponsRoute,
  PanelCouponCreateRoute,
  PanelCouponDetailRoute,
  PanelSettingsRoute,
  PanelSpacesRoute,
  PanelSpaceCreateRoute,
  PanelSpaceDetailRoute,
  PanelSpaceEventsRoute,
  PanelEventCreateRoute,
  PanelEventEditRoute,
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
export {
  SchedulerActivityDetailPage,
  SchedulerActivityPanel,
} from '../features/home/marketing/SchedulerActivityPanel.js';
export { SendDetailPage, SendsPanel, validateSendsSearch } from '../features/home/marketing/SendsPanel.js';

/**
 * The onboarding checklists are composed here, not inside the home feature:
 * features are import-islands, and this route is the feature's only mount —
 * delete `features/onboarding/` and this import to drop it wholesale.
 */
export const PanelIndexRoute = () => {
  const { tenant, email } = usePanelContext();
  return (
    <>
      <DashboardPanel />
      <StudioChecklistDock scope={`${tenant.id}:${email}`} />
    </>
  );
};
