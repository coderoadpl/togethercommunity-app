import { z } from 'zod';

import {
  attachModuleToCourseInputSchema,
  courseLessonSchema,
  courseModuleSchema,
  courseSchema,
  courseStructureWithAccessSchema,
  createApiKeyInputSchema,
  grantProductToMemberInputSchema,
  m2mEnrollInputSchema,
  memberExportFileSchema,
  memberGrantSchema,
  memberWithProductIdsSchema,
  revokeGrantInputSchema,
  membershipSchema,
  newCourseLessonSchema,
  newCourseModuleSchema,
  newCourseSchema,
  newProductSchema,
  nextLessonSchema,
  productAccessIssuesSchema,
  productSchema,
  progressViewSchema,
  staffRoleSchema,
  tenantApiKeyPublicSchema,
  tenantSchema,
  updateCourseInputSchema,
  updateCourseLessonInputSchema,
  updateCourseModuleInputSchema,
  updateLastViewedInputSchema,
  updateProductAccessItemsInputSchema,
} from '@core/domain/index.js';

/**
 * Single source of truth for the HTTP API shared by server and all clients.
 * Every route is described by its method, path and zod schemas; the server
 * implements them, `core/client` consumes them. Neither side hand-writes URLs
 * or response types anywhere else.
 */

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  database: z.enum(['up', 'down']),
});

export const authConfigOutputSchema = z.object({
  googleEnabled: z.boolean(),
  passkeysEnabled: z.boolean(),
  totpEnabled: z.boolean(),
});

export const meOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema.nullable(),
      memberId: z.string().nullable(),
    })
    .nullable(),
});

export const tenantListOutputSchema = z.object({
  tenants: z.array(membershipSchema),
});

export const productsListOutputSchema = z.object({
  products: z.array(productSchema),
});

export const publicOfferOutputSchema = z.object({
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
  }),
  contentVersion: z.number().int().positive(),
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
  ),
});

export const myProductsOutputSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
  ),
});

export const membersListOutputSchema = z.object({
  members: z.array(memberWithProductIdsSchema),
});

export const membersExportOutputSchema = memberExportFileSchema;

export const memberRemoveInputSchema = z.object({
  memberId: z.string().min(1),
});

export type MemberRemoveInput = z.input<typeof memberRemoveInputSchema>;

export const memberRemoveOutputSchema = z.object({
  memberId: z.string(),
});

export const memberGrantsOutputSchema = z.object({
  grants: z.array(memberGrantSchema),
});

export const grantCreateInputSchema = grantProductToMemberInputSchema;

export type GrantCreateInput = z.input<typeof grantCreateInputSchema>;

export const grantCreateOutputSchema = z.object({
  memberId: z.string(),
  grantId: z.string(),
  renewed: z.boolean(),
});

export const grantRevokeInputSchema = revokeGrantInputSchema;

export type GrantRevokeInput = z.input<typeof grantRevokeInputSchema>;

export const grantRevokeOutputSchema = z.object({
  grantId: z.string(),
  expiresAt: z.string().datetime(),
});

export const magicLinkSchema = z.object({
  email: z.string(),
  url: z.string(),
  token: z.string(),
});

export const simulatePurchaseInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
});

export type SimulatePurchaseInput = z.input<typeof simulatePurchaseInputSchema>;

export const simulatePurchaseOutputSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  alreadyOwned: z.boolean(),
  magicLink: magicLinkSchema.nullable(),
});

export const devMagicLinkOutputSchema = z.object({
  magicLink: magicLinkSchema.nullable(),
});

export const devEmailSchema = z.object({
  to: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export const devEmailOutputSchema = z.object({
  email: devEmailSchema.nullable(),
});

export const tenantCreateInputSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export type TenantCreateInput = z.input<typeof tenantCreateInputSchema>;

export const tenantCreateOutputSchema = z.object({
  tenant: tenantSchema,
});

export const productsCreateInputSchema = newProductSchema;

export const productsCreateOutputSchema = z.object({
  product: productSchema,
});

export const productsPublishInputSchema = z.object({
  id: z.string().min(1),
});

export type ProductsPublishInput = z.input<typeof productsPublishInputSchema>;

export const productsPublishOutputSchema = z.object({
  product: productSchema,
});

export const productsAccessItemsInputSchema = updateProductAccessItemsInputSchema;

export type ProductsAccessItemsInput = z.input<typeof productsAccessItemsInputSchema>;

export const productsAccessItemsOutputSchema = z.object({
  product: productSchema,
});

export const productsAccessIssuesOutputSchema = z.object({
  issues: z.array(productAccessIssuesSchema),
});

export const coursesListOutputSchema = z.object({
  courses: z.array(courseSchema),
});

export const modulesListOutputSchema = z.object({
  modules: z.array(courseModuleSchema),
});

export const lessonsListOutputSchema = z.object({
  lessons: z.array(courseLessonSchema),
});

export const courseCreateInputSchema = newCourseSchema;

export type CourseCreateInput = z.input<typeof courseCreateInputSchema>;

export const courseUpdateInputSchema = updateCourseInputSchema;

export type CourseUpdateInput = z.input<typeof courseUpdateInputSchema>;

export const courseOutputSchema = z.object({
  course: courseSchema,
});

export const moduleCreateInputSchema = newCourseModuleSchema;

export type ModuleCreateInput = z.input<typeof moduleCreateInputSchema>;

export const moduleUpdateInputSchema = updateCourseModuleInputSchema;

export type ModuleUpdateInput = z.input<typeof moduleUpdateInputSchema>;

export const moduleAttachInputSchema = attachModuleToCourseInputSchema;

export type ModuleAttachInput = z.input<typeof moduleAttachInputSchema>;

export const moduleOutputSchema = z.object({
  module: courseModuleSchema,
});

export const lessonCreateInputSchema = newCourseLessonSchema;

export type LessonCreateInput = z.input<typeof lessonCreateInputSchema>;

export const lessonUpdateInputSchema = updateCourseLessonInputSchema;

export type LessonUpdateInput = z.input<typeof lessonUpdateInputSchema>;

export const lessonOutputSchema = z.object({
  lesson: courseLessonSchema,
});

export const studentCoursesOutputSchema = z.object({
  courses: z.array(courseSchema),
});

export const courseStructureOutputSchema = z.object({
  structure: courseStructureWithAccessSchema,
});

export const studentLessonOutputSchema = z.object({
  lesson: courseLessonSchema,
});

export const lessonCompleteInputSchema = z.object({
  lessonId: z.string().min(1),
});

export type LessonCompleteInput = z.input<typeof lessonCompleteInputSchema>;

export const lastViewedInputSchema = updateLastViewedInputSchema;

export type LastViewedInput = z.input<typeof lastViewedInputSchema>;

export const progressOutputSchema = z.object({
  progress: progressViewSchema,
});

export const nextLessonOutputSchema = z.object({
  next: nextLessonSchema,
});

export const devGrantOutputSchema = z.object({
  memberId: z.string(),
  productId: z.string(),
  granted: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});

export const apiKeysListOutputSchema = z.object({
  apiKeys: z.array(tenantApiKeyPublicSchema),
});

export const apiKeyCreateInputSchema = createApiKeyInputSchema;

export type ApiKeyCreateInput = z.input<typeof apiKeyCreateInputSchema>;

export const apiKeyCreateOutputSchema = z.object({
  apiKey: tenantApiKeyPublicSchema,
  secret: z.string(),
});

export const apiKeyRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export type ApiKeyRevokeInput = z.input<typeof apiKeyRevokeInputSchema>;

export const apiKeyRevokeOutputSchema = z.object({
  apiKey: tenantApiKeyPublicSchema,
});

export const m2mEnrollRequestSchema = m2mEnrollInputSchema;

export type M2mEnrollRequest = z.input<typeof m2mEnrollRequestSchema>;

export const m2mEnrollOutputSchema = z.object({
  memberId: z.string(),
  grantId: z.string(),
  renewed: z.boolean(),
  magicLink: magicLinkSchema.nullable(),
});

/**
 * Every route carries its HTTP method so clients can discriminate reads from
 * writes at the type level (CQRS partition). Safe GETs are queries; unsafe
 * verbs are commands. `core/client` brands its call surface from these methods.
 */
export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  publicOffer: { method: 'GET', path: '/api/public/offer' },
  authConfig: { method: 'GET', path: '/api/public/auth-config' },
  me: { method: 'GET', path: '/api/me' },
  tenants: { method: 'GET', path: '/api/tenants' },
  tenantsCreate: { method: 'POST', path: '/api/tenants' },
  products: { method: 'GET', path: '/api/products' },
  productsCreate: { method: 'POST', path: '/api/products' },
  productsPublish: { method: 'POST', path: '/api/products/publish' },
  productsAccessItems: { method: 'POST', path: '/api/products/access-items' },
  productsAccessIssues: { method: 'GET', path: '/api/products/access-issues' },
  courses: { method: 'GET', path: '/api/courses' },
  coursesCreate: { method: 'POST', path: '/api/courses' },
  coursesUpdate: { method: 'POST', path: '/api/courses/update' },
  modules: { method: 'GET', path: '/api/modules' },
  modulesCreate: { method: 'POST', path: '/api/modules' },
  modulesUpdate: { method: 'POST', path: '/api/modules/update' },
  modulesAttach: { method: 'POST', path: '/api/modules/attach' },
  lessons: { method: 'GET', path: '/api/lessons' },
  lessonsCreate: { method: 'POST', path: '/api/lessons' },
  lessonsUpdate: { method: 'POST', path: '/api/lessons/update' },
  studentCourses: { method: 'GET', path: '/api/student/courses' },
  studentCourseStructure: { method: 'GET', path: '/api/student/courses/:courseId/structure' },
  studentLesson: { method: 'GET', path: '/api/student/lessons/:lessonId' },
  studentLessonComplete: { method: 'POST', path: '/api/student/lessons/complete' },
  studentLessonNext: { method: 'GET', path: '/api/student/lessons/next' },
  studentLastViewed: { method: 'POST', path: '/api/student/progress/last-viewed' },
  studentProgress: { method: 'GET', path: '/api/student/progress' },
  devGrant: { method: 'POST', path: '/api/dev/grant' },
  myProducts: { method: 'GET', path: '/api/my/products' },
  members: { method: 'GET', path: '/api/members' },
  membersExport: { method: 'GET', path: '/api/members/export' },
  memberGrants: { method: 'GET', path: '/api/members/:memberId/grants' },
  memberRemove: { method: 'DELETE', path: '/api/members/:memberId' },
  grantsCreate: { method: 'POST', path: '/api/grants' },
  grantRevoke: { method: 'DELETE', path: '/api/grants/:grantId' },
  devSimulatePurchase: { method: 'POST', path: '/api/dev/simulate-purchase' },
  devMagicLink: { method: 'GET', path: '/api/dev/magic-link' },
  devEmail: { method: 'GET', path: '/api/dev/email' },
  apiKeys: { method: 'GET', path: '/api/api-keys' },
  apiKeysCreate: { method: 'POST', path: '/api/api-keys' },
  apiKeyRevoke: { method: 'DELETE', path: '/api/api-keys/:id' },
  m2mEnroll: { method: 'POST', path: '/api/m2m/enroll' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  publicOffer: API_ROUTES.publicOffer.path,
  authConfig: API_ROUTES.authConfig.path,
  me: API_ROUTES.me.path,
  tenants: API_ROUTES.tenants.path,
  products: API_ROUTES.products.path,
  productsPublish: API_ROUTES.productsPublish.path,
  productsAccessItems: API_ROUTES.productsAccessItems.path,
  productsAccessIssues: API_ROUTES.productsAccessIssues.path,
  courses: API_ROUTES.courses.path,
  coursesUpdate: API_ROUTES.coursesUpdate.path,
  modules: API_ROUTES.modules.path,
  modulesCreate: API_ROUTES.modulesCreate.path,
  modulesUpdate: API_ROUTES.modulesUpdate.path,
  modulesAttach: API_ROUTES.modulesAttach.path,
  lessons: API_ROUTES.lessons.path,
  lessonsCreate: API_ROUTES.lessonsCreate.path,
  lessonsUpdate: API_ROUTES.lessonsUpdate.path,
  studentCourses: API_ROUTES.studentCourses.path,
  studentCourseStructure: API_ROUTES.studentCourseStructure.path,
  studentLesson: API_ROUTES.studentLesson.path,
  studentLessonComplete: API_ROUTES.studentLessonComplete.path,
  studentLessonNext: API_ROUTES.studentLessonNext.path,
  studentLastViewed: API_ROUTES.studentLastViewed.path,
  studentProgress: API_ROUTES.studentProgress.path,
  devGrant: API_ROUTES.devGrant.path,
  myProducts: API_ROUTES.myProducts.path,
  members: API_ROUTES.members.path,
  membersExport: API_ROUTES.membersExport.path,
  memberGrants: API_ROUTES.memberGrants.path,
  memberRemove: API_ROUTES.memberRemove.path,
  grantsCreate: API_ROUTES.grantsCreate.path,
  grantRevoke: API_ROUTES.grantRevoke.path,
  devSimulatePurchase: API_ROUTES.devSimulatePurchase.path,
  devMagicLink: API_ROUTES.devMagicLink.path,
  devEmail: API_ROUTES.devEmail.path,
  apiKeys: API_ROUTES.apiKeys.path,
  apiKeyRevoke: API_ROUTES.apiKeyRevoke.path,
  m2mEnroll: API_ROUTES.m2mEnroll.path,
} as const;

/** Header used by non-browser clients (CLI, tests) to select the tenant. */
export const TENANT_HEADER = 'x-tenant';

/** Header carrying a tenant API-key secret for the M2M enroll endpoint. */
export const API_KEY_HEADER = 'x-api-key';
