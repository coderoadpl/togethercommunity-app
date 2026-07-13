import { type z } from 'zod';

import {
  API_ROUTES,
  looseEnvelopeSchema,
  apiKeyCreateOutputSchema,
  apiKeyRevokeOutputSchema,
  apiKeysListOutputSchema,
  authConfigOutputSchema,
  courseOutputSchema,
  courseStructureOutputSchema,
  coursesListOutputSchema,
  devGrantOutputSchema,
  devEmailOutputSchema,
  devMagicLinkOutputSchema,
  grantCreateOutputSchema,
  grantRevokeOutputSchema,
  healthOutputSchema,
  lessonOutputSchema,
  lessonsListOutputSchema,
  m2mEnrollOutputSchema,
  meOutputSchema,
  memberGrantsOutputSchema,
  memberRemoveOutputSchema,
  membersListOutputSchema,
  membersExportOutputSchema,
  moduleOutputSchema,
  modulesListOutputSchema,
  myProductsOutputSchema,
  nextLessonOutputSchema,
  productsAccessItemsOutputSchema,
  productsAccessIssuesOutputSchema,
  progressOutputSchema,
  publicOfferOutputSchema,
  productsCreateOutputSchema,
  productsListOutputSchema,
  productsPublishOutputSchema,
  simulatePurchaseOutputSchema,
  studentCoursesOutputSchema,
  studentLessonOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  type ApiKeyCreateInput,
  type ApiKeyRevokeInput,
  type CourseCreateInput,
  type CourseUpdateInput,
  type GrantCreateInput,
  type GrantRevokeInput,
  type HttpMethod,
  type LastViewedInput,
  type LessonCompleteInput,
  type LessonCreateInput,
  type LessonUpdateInput,
  type M2mEnrollRequest,
  type MemberRemoveInput,
  type ModuleAttachInput,
  type ModuleCreateInput,
  type ModuleUpdateInput,
  type ProductsAccessItemsInput,
  type ProductsPublishInput,
  type ReadMethod,
  type SimulatePurchaseInput,
  type TenantCreateInput,
  type WriteMethod,
} from '@core/contract/index.js';
import {
  err,
  internal,
  ok,
  type AppError,
  type DevGrantInput,
  type MemberExportFormat,
  type NewProductInput,
  type Result,
} from '@core/domain/index.js';

declare const HTTP_METHOD_BRAND: unique symbol;

/**
 * Phantom read/write tag on a call's result, driven by the contract's HTTP
 * method. Optional and never assigned at runtime (zero cost, no `as`): a plain
 * `Result` is assignable, yet a `'GET'`-tagged result is not assignable to a
 * `'POST'`-tagged one, so `defineQuery`/`defineMutation` can reject mismatches.
 */
type Branded<T, M extends HttpMethod> = T & { readonly [HTTP_METHOD_BRAND]?: M };
export type ReadResult<T> = Branded<Result<T, AppError>, ReadMethod>;
export type WriteResult<T> = Branded<Result<T, AppError>, WriteMethod>;

export interface ApiClientOptions {
  /** '' for same-origin (web); absolute URL for CLI and other clients. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers per request: Authorization bearer token, X-Tenant, ... */
  headers?: () => Record<string, string>;
  /**
   * W3C `traceparent` for the currently active span, or `undefined` when no
   * trace is active. Injected header-provider (bound in the composition root)
   * rather than an in-core OTel dependency: keeps `core/client` framework- and
   * SDK-free and makes propagation trivially testable by passing a stub.
   */
  traceparent?: () => string | undefined;
}

const request = async <S extends z.ZodTypeAny, M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  outputSchema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Branded<Result<z.output<S>, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceparent = options.traceparent?.();
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(traceparent === undefined ? {} : { traceparent }),
        ...options.headers?.(),
      },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: 'include',
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error calling ${path}: ${String(cause)}`));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err(internal(`Non-JSON response from ${path} (HTTP ${response.status})`));
  }

  const envelope = looseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return err(internal(`Response from ${path} does not match the contract envelope`));
  }
  if (!envelope.data.ok) return err(envelope.data.error);

  const data = outputSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err(internal(`Response data from ${path} does not match the contract`));
  }
  return ok(data.data);
};

/** The single typed gateway to the API. No client ever hand-writes HTTP. */
export const createApiClient = (options: ApiClientOptions) => ({
  health: (signal?: AbortSignal) =>
    request(options, API_ROUTES.health.method, API_ROUTES.health.path, healthOutputSchema, undefined, signal),
  publicOffer: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.publicOffer.method,
      API_ROUTES.publicOffer.path,
      publicOfferOutputSchema,
      undefined,
      signal,
    ),
  authConfig: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.authConfig.method,
      API_ROUTES.authConfig.path,
      authConfigOutputSchema,
      undefined,
      signal,
    ),
  me: (signal?: AbortSignal) =>
    request(options, API_ROUTES.me.method, API_ROUTES.me.path, meOutputSchema, undefined, signal),
  listTenants: (signal?: AbortSignal) =>
    request(options, API_ROUTES.tenants.method, API_ROUTES.tenants.path, tenantListOutputSchema, undefined, signal),
  createTenant: (input: TenantCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantsCreate.method,
      API_ROUTES.tenantsCreate.path,
      tenantCreateOutputSchema,
      input,
      signal,
    ),
  listProducts: (signal?: AbortSignal) =>
    request(options, API_ROUTES.products.method, API_ROUTES.products.path, productsListOutputSchema, undefined, signal),
  createProduct: (input: NewProductInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsCreate.method,
      API_ROUTES.productsCreate.path,
      productsCreateOutputSchema,
      input,
      signal,
    ),
  publishProduct: (input: ProductsPublishInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsPublish.method,
      API_ROUTES.productsPublish.path,
      productsPublishOutputSchema,
      input,
      signal,
    ),
  myProducts: (signal?: AbortSignal) =>
    request(options, API_ROUTES.myProducts.method, API_ROUTES.myProducts.path, myProductsOutputSchema, undefined, signal),
  listMembers: (signal?: AbortSignal) =>
    request(options, API_ROUTES.members.method, API_ROUTES.members.path, membersListOutputSchema, undefined, signal),
  exportMembers: (format: MemberExportFormat, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.membersExport.method,
      `${API_ROUTES.membersExport.path}?format=${encodeURIComponent(format)}`,
      membersExportOutputSchema,
      undefined,
      signal,
    ),
  removeMember: (input: MemberRemoveInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberRemove.method,
      API_ROUTES.memberRemove.path.replace(':memberId', encodeURIComponent(input.memberId)),
      memberRemoveOutputSchema,
      undefined,
      signal,
    ),
  listMemberGrants: (memberId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.memberGrants.method,
      API_ROUTES.memberGrants.path.replace(':memberId', encodeURIComponent(memberId)),
      memberGrantsOutputSchema,
      undefined,
      signal,
    ),
  grantProductToMember: (input: GrantCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.grantsCreate.method,
      API_ROUTES.grantsCreate.path,
      grantCreateOutputSchema,
      input,
      signal,
    ),
  revokeGrant: (input: GrantRevokeInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.grantRevoke.method,
      API_ROUTES.grantRevoke.path.replace(':grantId', encodeURIComponent(input.grantId)),
      grantRevokeOutputSchema,
      undefined,
      signal,
    ),
  simulatePurchase: (input: SimulatePurchaseInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devSimulatePurchase.method,
      API_ROUTES.devSimulatePurchase.path,
      simulatePurchaseOutputSchema,
      input,
      signal,
    ),
  devMagicLink: (email: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devMagicLink.method,
      `${API_ROUTES.devMagicLink.path}?email=${encodeURIComponent(email)}`,
      devMagicLinkOutputSchema,
      undefined,
      signal,
    ),
  devEmail: (to: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.devEmail.method,
      `${API_ROUTES.devEmail.path}?to=${encodeURIComponent(to)}`,
      devEmailOutputSchema,
      undefined,
      signal,
    ),
  updateProductAccessItems: (input: ProductsAccessItemsInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsAccessItems.method,
      API_ROUTES.productsAccessItems.path,
      productsAccessItemsOutputSchema,
      input,
      signal,
    ),
  listProductAccessIssues: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.productsAccessIssues.method,
      API_ROUTES.productsAccessIssues.path,
      productsAccessIssuesOutputSchema,
      undefined,
      signal,
    ),
  listCourses: (signal?: AbortSignal) =>
    request(options, API_ROUTES.courses.method, API_ROUTES.courses.path, coursesListOutputSchema, undefined, signal),
  createCourse: (input: CourseCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.coursesCreate.method, API_ROUTES.coursesCreate.path, courseOutputSchema, input, signal),
  updateCourse: (input: CourseUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.coursesUpdate.method, API_ROUTES.coursesUpdate.path, courseOutputSchema, input, signal),
  listModules: (signal?: AbortSignal) =>
    request(options, API_ROUTES.modules.method, API_ROUTES.modules.path, modulesListOutputSchema, undefined, signal),
  createModule: (input: ModuleCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesCreate.method, API_ROUTES.modulesCreate.path, moduleOutputSchema, input, signal),
  updateModule: (input: ModuleUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesUpdate.method, API_ROUTES.modulesUpdate.path, moduleOutputSchema, input, signal),
  attachModuleToCourse: (input: ModuleAttachInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.modulesAttach.method, API_ROUTES.modulesAttach.path, moduleOutputSchema, input, signal),
  listLessons: (signal?: AbortSignal) =>
    request(options, API_ROUTES.lessons.method, API_ROUTES.lessons.path, lessonsListOutputSchema, undefined, signal),
  createLesson: (input: LessonCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.lessonsCreate.method, API_ROUTES.lessonsCreate.path, lessonOutputSchema, input, signal),
  updateLesson: (input: LessonUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.lessonsUpdate.method, API_ROUTES.lessonsUpdate.path, lessonOutputSchema, input, signal),
  studentCourses: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentCourses.method,
      API_ROUTES.studentCourses.path,
      studentCoursesOutputSchema,
      undefined,
      signal,
    ),
  studentCourseStructure: (courseId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentCourseStructure.method,
      API_ROUTES.studentCourseStructure.path.replace(':courseId', encodeURIComponent(courseId)),
      courseStructureOutputSchema,
      undefined,
      signal,
    ),
  studentLesson: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLesson.method,
      API_ROUTES.studentLesson.path.replace(':lessonId', encodeURIComponent(lessonId)),
      studentLessonOutputSchema,
      undefined,
      signal,
    ),
  completeLesson: (input: LessonCompleteInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLessonComplete.method,
      API_ROUTES.studentLessonComplete.path,
      progressOutputSchema,
      input,
      signal,
    ),
  nextLesson: (lessonId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLessonNext.method,
      `${API_ROUTES.studentLessonNext.path}?lessonId=${encodeURIComponent(lessonId)}`,
      nextLessonOutputSchema,
      undefined,
      signal,
    ),
  updateLastViewed: (input: LastViewedInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentLastViewed.method,
      API_ROUTES.studentLastViewed.path,
      progressOutputSchema,
      input,
      signal,
    ),
  studentProgress: (courseId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.studentProgress.method,
      `${API_ROUTES.studentProgress.path}?courseId=${encodeURIComponent(courseId)}`,
      progressOutputSchema,
      undefined,
      signal,
    ),
  devGrant: (input: DevGrantInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.devGrant.method, API_ROUTES.devGrant.path, devGrantOutputSchema, input, signal),
  listApiKeys: (signal?: AbortSignal) =>
    request(options, API_ROUTES.apiKeys.method, API_ROUTES.apiKeys.path, apiKeysListOutputSchema, undefined, signal),
  createApiKey: (input: ApiKeyCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiKeysCreate.method,
      API_ROUTES.apiKeysCreate.path,
      apiKeyCreateOutputSchema,
      input,
      signal,
    ),
  revokeApiKey: (input: ApiKeyRevokeInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiKeyRevoke.method,
      API_ROUTES.apiKeyRevoke.path.replace(':id', encodeURIComponent(input.id)),
      apiKeyRevokeOutputSchema,
      undefined,
      signal,
    ),
  m2mEnroll: (input: M2mEnrollRequest, signal?: AbortSignal) =>
    request(options, API_ROUTES.m2mEnroll.method, API_ROUTES.m2mEnroll.path, m2mEnrollOutputSchema, input, signal),
});

export type ApiClient = ReturnType<typeof createApiClient>;

/** For TanStack Query: converts a Result into value-or-throw at the query boundary. */
export const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
};

export class ApiError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'ApiError';
    this.appError = appError;
  }
}
