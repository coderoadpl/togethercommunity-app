import type {
  DefaultError,
  FetchQueryOptions,
  MutationFunction,
  MutationKey,
  MutationOptions,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';

import type {
  ApiKeyCreateInput,
  ApiKeyRevokeInput,
  CourseCreateInput,
  CheckoutSessionRequest,
  CourseUpdateInput,
  GrantCreateInput,
  GrantRevokeInput,
  LastViewedInput,
  LessonCompleteInput,
  LessonCreateInput,
  LessonUpdateInput,
  MemberRemoveInput,
  ModuleAttachInput,
  ModuleDetachInput,
  ModuleCreateInput,
  ModuleUpdateInput,
  NotificationReadInput,
  NotificationsListInput,
  DiscussionGetInput,
  PostCreateInput,
  PostDeleteInput,
  PostUpdateInput,
  PostsSearchInput,
  ProductsAccessItemsInput,
  ProductsPublishInput,
  SimulatePurchaseInput,
  TenantCreateInput,
  TenantSecretDeleteInput,
  TenantSecretSetInput,
  TenantSettingsUpdateInput,
} from '@core/contract/index.js';
import type { DevGrantInput, EntityKind, MemberExportFormat, NewProductInput } from '@core/domain/index.js';

import type { AuthClientPort, AuthSessionResult } from './auth-port.js';
import { unwrap, type ApiClient, type ReadResult, type WriteResult } from './http.js';

/**
 * Identity helpers that type descriptors against `@tanstack/query-core` option
 * types (never `@tanstack/react-query`, which `core/client` may not import).
 * They bind the `queryFn` result type to the key so `useQuery`/`useMutation`
 * infer `data`/`variables` at the call site without explicit generics.
 *
 * CQRS partition is enforced here: `defineQuery` accepts only a read-tagged
 * `call` (a GET contract route), `defineMutation` only a write-tagged one.
 * Each helper owns the `unwrap` so the tag never leaks into `data`/`variables`.
 */
export type QueryDescriptor<TQueryFnData, TQueryKey extends QueryKey> = FetchQueryOptions<
  TQueryFnData,
  DefaultError,
  TQueryFnData,
  TQueryKey
> & { queryFn: QueryFunction<TQueryFnData, TQueryKey> };

type ReadCall<TQueryFnData, TQueryKey extends QueryKey> = (
  context: QueryFunctionContext<TQueryKey>,
) => Promise<ReadResult<TQueryFnData>>;

type DefineQueryInput<TQueryFnData, TQueryKey extends QueryKey> = Omit<
  QueryDescriptor<TQueryFnData, TQueryKey>,
  'queryFn'
> & { call: ReadCall<TQueryFnData, TQueryKey> };

export const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
  input: DefineQueryInput<TQueryFnData, TQueryKey>,
): QueryDescriptor<TQueryFnData, TQueryKey> => {
  const { call, ...rest } = input;
  return { ...rest, queryFn: async (context) => unwrap(await call(context)) };
};

export type MutationDescriptor<TData, TVariables> = MutationOptions<
  TData,
  DefaultError,
  TVariables
> & { mutationKey: MutationKey; mutationFn: MutationFunction<TData, TVariables> };

type WriteCall<TData, TVariables> = (variables: TVariables) => Promise<WriteResult<TData>>;

type DefineMutationInput<TData, TVariables> = Omit<
  MutationDescriptor<TData, TVariables>,
  'mutationFn'
> & { call: WriteCall<TData, TVariables> };

export const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

/**
 * Query keys are the public API of each resource: general → specific, matched
 * by prefix for invalidation and per-prefix defaults. Never hand-copy a key.
 */
export const meScopes = {
  all: () => ['me'] as const,
};

export const tenantsScopes = {
  all: () => ['tenants'] as const,
};

export const publicOfferScopes = {
  all: () => ['public-offer'] as const,
};

export const authConfigScopes = {
  all: () => ['auth-config'] as const,
};

export const productsScopes = {
  all: () => ['products'] as const,
  lists: () => ['products', 'list'] as const,
  issues: () => ['products', 'issues'] as const,
};

export const myProductsScopes = {
  all: () => ['my-products'] as const,
};

export const membersScopes = {
  all: () => ['members'] as const,
  export: (format: MemberExportFormat) => ['members', 'export', format] as const,
  grants: (memberId: string) => ['members', 'grants', memberId] as const,
};

export const authScopes = {
  all: () => ['auth'] as const,
  magicLink: (email: string) => ['auth', 'dev-magic-link', email] as const,
};

export const apiKeysScopes = {
  all: () => ['api-keys'] as const,
  lists: () => ['api-keys', 'list'] as const,
};

export const tenantSecretsScopes = {
  all: () => ['tenant-secrets'] as const,
  lists: () => ['tenant-secrets', 'list'] as const,
};

export const tenantSettingsScopes = {
  all: () => ['tenant-settings'] as const,
};

export const coursesScopes = {
  all: () => ['courses'] as const,
  lists: () => ['courses', 'list'] as const,
};

export const modulesScopes = {
  all: () => ['modules'] as const,
};

export const contentHistoryScopes = {
  all: () => ['content-history'] as const,
  list: (entityKind: EntityKind, entityId: string) =>
    ['content-history', 'list', entityKind, entityId] as const,
  version: (id: string) => ['content-history', 'version', id] as const,
};

export const lessonsScopes = {
  all: () => ['lessons'] as const,
  references: (lessonId: string) => ['lessons', 'references', lessonId] as const,
};

export const studentScopes = {
  all: () => ['student'] as const,
  courses: () => ['student', 'courses'] as const,
  courseStructure: (courseId: string) => ['student', 'course-structure', courseId] as const,
  lesson: (lessonId: string) => ['student', 'lesson', lessonId] as const,
  nextLesson: (lessonId: string) => ['student', 'next-lesson', lessonId] as const,
  progress: (courseId: string) => ['student', 'progress', courseId] as const,
};

export const discussionScopes = {
  all: () => ['discussion'] as const,
  lesson: (lessonId: string) => ['discussion', 'lesson', lessonId] as const,
  search: (query: string) => ['discussion', 'search', query] as const,
};

export const notificationScopes = {
  all: () => ['notifications'] as const,
  list: () => ['notifications', 'list'] as const,
  unread: () => ['notifications', 'unread'] as const,
};

export const meQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: meScopes.all(),
    call: ({ signal }) => api.me(signal),
  });

export const tenantsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantsScopes.all(),
    call: ({ signal }) => api.listTenants(signal),
  });

export const publicOfferQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: publicOfferScopes.all(),
    call: ({ signal }) => api.publicOffer(signal),
  });

export const publicPaymentConfigQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: ['payment-config'] as const,
    call: ({ signal }) => api.publicPaymentConfig(signal),
  });

export const createCheckoutSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['checkout-session'] as const,
    call: (input: CheckoutSessionRequest) => api.createCheckoutSession(input),
  });

export const authConfigQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: authConfigScopes.all(),
    call: ({ signal }) => api.authConfig(signal),
  });

export const createTenantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantsScopes.all(), 'create'],
    call: (input: TenantCreateInput) => api.createTenant(input),
  });

export const productsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: productsScopes.lists(),
    call: ({ signal }) => api.listProducts(signal),
  });

export const createProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'create'],
    call: (input: NewProductInput) => api.createProduct(input),
  });

export const publishProductMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'publish'],
    call: (input: ProductsPublishInput) => api.publishProduct(input),
  });

export const myProductsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: myProductsScopes.all(),
    call: ({ signal }) => api.myProducts(signal),
  });

export const membersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: membersScopes.all(),
    call: ({ signal }) => api.listMembers(signal),
  });

export const membersExportQuery = (api: ApiClient, format: MemberExportFormat) =>
  defineQuery({
    queryKey: membersScopes.export(format),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.exportMembers(format, signal),
  });

export const removeMemberMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'remove'],
    call: (input: MemberRemoveInput) => api.removeMember(input),
  });

export const memberGrantsQuery = (api: ApiClient, memberId: string) =>
  defineQuery({
    queryKey: membersScopes.grants(memberId),
    call: ({ signal }) => api.listMemberGrants(memberId, signal),
  });

export const grantProductToMemberMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'grant'],
    call: (input: GrantCreateInput) => api.grantProductToMember(input),
  });

export const revokeGrantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'revoke-grant'],
    call: (input: GrantRevokeInput) => api.revokeGrant(input),
  });

export const simulatePurchaseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...myProductsScopes.all(), 'simulate-purchase'],
    call: (input: SimulatePurchaseInput) => api.simulatePurchase(input),
  });

export const devMagicLinkQuery = (api: ApiClient, email: string) =>
  defineQuery({
    queryKey: authScopes.magicLink(email),
    call: ({ signal }) => api.devMagicLink(email, signal),
  });

export const coursesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: coursesScopes.lists(),
    call: ({ signal }) => api.listCourses(signal),
  });

export const createCourseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...coursesScopes.all(), 'create'],
    call: (input: CourseCreateInput) => api.createCourse(input),
  });

export const updateCourseMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...coursesScopes.all(), 'update'],
    call: (input: CourseUpdateInput) => api.updateCourse(input),
  });

export const modulesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: modulesScopes.all(),
    call: ({ signal }) => api.listModules(signal),
  });

export const contentHistoryQuery = (
  api: ApiClient,
  input: { entityKind: EntityKind; entityId: string; limit?: number },
) =>
  defineQuery({
    queryKey: contentHistoryScopes.list(input.entityKind, input.entityId),
    call: ({ signal }) => api.listContentHistory(input, signal),
  });

export const contentVersionQuery = (api: ApiClient, id: string) =>
  defineQuery({
    queryKey: contentHistoryScopes.version(id),
    call: ({ signal }) => api.getContentVersion(id, signal),
  });

export const lessonsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: lessonsScopes.all(),
    call: ({ signal }) => api.listLessons(signal),
  });

export const createModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'create'],
    call: (input: ModuleCreateInput) => api.createModule(input),
  });

export const updateModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'update'],
    call: (input: ModuleUpdateInput) => api.updateModule(input),
  });

export const attachModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'attach'],
    call: (input: ModuleAttachInput) => api.attachModuleToCourse(input),
  });

export const detachModuleMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...modulesScopes.all(), 'detach'],
    call: (input: ModuleDetachInput) => api.detachModuleFromCourse(input),
  });

export const createLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'create'],
    call: (input: LessonCreateInput) => api.createLesson(input),
  });

export const updateLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'update'],
    call: (input: LessonUpdateInput) => api.updateLesson(input),
  });

export const lessonReferencesQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: lessonsScopes.references(lessonId),
    staleTime: 0,
    gcTime: 0,
    call: ({ signal }) => api.lessonReferences(lessonId, signal),
  });

export const deleteLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...lessonsScopes.all(), 'delete'],
    call: (lessonId: string) => api.deleteLesson(lessonId),
  });

export const updateProductAccessItemsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...productsScopes.all(), 'access-items'],
    call: (input: ProductsAccessItemsInput) => api.updateProductAccessItems(input),
  });

export const productAccessIssuesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: productsScopes.issues(),
    call: ({ signal }) => api.listProductAccessIssues(signal),
  });

export const studentCoursesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: studentScopes.courses(),
    call: ({ signal }) => api.studentCourses(signal),
  });

export const courseStructureQuery = (api: ApiClient, courseId: string) =>
  defineQuery({
    queryKey: studentScopes.courseStructure(courseId),
    call: ({ signal }) => api.studentCourseStructure(courseId, signal),
  });

export const studentLessonQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: studentScopes.lesson(lessonId),
    call: ({ signal }) => api.studentLesson(lessonId, signal),
  });

export const nextLessonQuery = (api: ApiClient, lessonId: string) =>
  defineQuery({
    queryKey: studentScopes.nextLesson(lessonId),
    call: ({ signal }) => api.nextLesson(lessonId, signal),
  });

export const studentProgressQuery = (api: ApiClient, courseId: string) =>
  defineQuery({
    queryKey: studentScopes.progress(courseId),
    call: ({ signal }) => api.studentProgress(courseId, signal),
  });

export const completeLessonMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...studentScopes.all(), 'complete-lesson'],
    call: (input: LessonCompleteInput) => api.completeLesson(input),
  });

export const updateLastViewedMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...studentScopes.all(), 'last-viewed'],
    call: (input: LastViewedInput) => api.updateLastViewed(input),
  });

export const discussionQuery = (api: ApiClient, input: DiscussionGetInput) =>
  defineQuery({
    queryKey: discussionScopes.lesson(input.contextId),
    call: ({ signal }) => api.discussion(input, signal),
  });

export const createPostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'create-post'],
    call: (input: PostCreateInput) => api.createPost(input),
  });

export const updatePostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'update-post'],
    call: (input: PostUpdateInput) => api.updatePost(input),
  });

export const deletePostMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'delete-post'],
    call: (input: PostDeleteInput) => api.deletePost(input),
  });

export const subscribeThreadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'subscribe'],
    call: (input: { rootPostId: string }) => api.subscribeThread(input),
  });

export const muteThreadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...discussionScopes.all(), 'mute'],
    call: (input: { rootPostId: string }) => api.muteThread(input),
  });

export const postsSearchQuery = (api: ApiClient, input: PostsSearchInput) =>
  defineQuery({
    queryKey: discussionScopes.search(input.query),
    call: ({ signal }) => api.searchPosts(input, signal),
  });

export const notificationsQuery = (api: ApiClient, input: NotificationsListInput = {}) =>
  defineQuery({
    queryKey: notificationScopes.list(),
    call: ({ signal }) => api.listNotifications(input, signal),
  });

export const unreadNotificationsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: notificationScopes.unread(),
    call: ({ signal }) => api.unreadNotificationCount(signal),
  });

export const markNotificationReadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...notificationScopes.all(), 'read'],
    call: (input: NotificationReadInput) => api.markNotificationRead(input),
  });

export const markAllNotificationsReadMutation = (
  api: ApiClient,
): MutationDescriptor<{ read: number }, void> =>
  defineMutation({
    mutationKey: [...notificationScopes.all(), 'read-all'],
    call: () => api.markAllNotificationsRead(),
  });

export const devGrantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: ['dev', 'grant'],
    call: (input: DevGrantInput) => api.devGrant(input),
  });

export const apiKeysQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: apiKeysScopes.lists(),
    call: ({ signal }) => api.listApiKeys(signal),
  });

export const createApiKeyMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiKeysScopes.all(), 'create'],
    call: (input: ApiKeyCreateInput) => api.createApiKey(input),
  });

export const revokeApiKeyMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiKeysScopes.all(), 'revoke'],
    call: (input: ApiKeyRevokeInput) => api.revokeApiKey(input),
  });

export const apiKeysInvalidates = () => ({ queryKey: apiKeysScopes.lists() });

export const tenantSecretsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantSecretsScopes.lists(),
    call: ({ signal }) => api.listTenantSecrets(signal),
  });

export const setTenantSecretMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'set'],
    call: (input: TenantSecretSetInput) => api.setTenantSecret(input),
  });

export const deleteTenantSecretMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'delete'],
    call: (input: TenantSecretDeleteInput) => api.deleteTenantSecret(input),
  });

export const testStripeConnectionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSecretsScopes.all(), 'stripe-test'],
    call: () => api.testStripeConnection(),
  });

export const tenantSecretsInvalidates = () => ({ queryKey: tenantSecretsScopes.lists() });

export const tenantSettingsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantSettingsScopes.all(),
    call: ({ signal }) => api.getTenantSettings(signal),
  });

export const updateTenantSettingsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSettingsScopes.all(), 'update'],
    call: (input: TenantSettingsUpdateInput) => api.updateTenantSettings(input),
  });

export const tenantSettingsInvalidates = () => ({ queryKey: tenantSettingsScopes.all() });

/** Invalidation filters for the course tree editor (courses, modules, lessons). */
export const coursesInvalidates = () => ({ queryKey: coursesScopes.lists() });

export const modulesInvalidates = () => ({ queryKey: modulesScopes.all() });

export const lessonsInvalidates = () => ({ queryKey: lessonsScopes.all() });

/** The invalidation filter product mutations apply after they settle. */
export const productsInvalidates = () => ({ queryKey: productsScopes.all() });

/** The invalidation filter a simulated purchase applies after it settles. */
export const myProductsInvalidates = () => ({ queryKey: myProductsScopes.all() });

export const membersInvalidates = () => ({ queryKey: membersScopes.all() });

export const memberGrantsInvalidates = (memberId: string) => ({ queryKey: membersScopes.grants(memberId) });

/** Invalidation filter progress mutations apply to refresh a course's tree. */
export const studentCourseInvalidates = () => ({ queryKey: studentScopes.all() });

export const notificationsInvalidates = () => ({ queryKey: notificationScopes.all() });

/**
 * Auth side effects are mutation descriptors over `AuthClientPort` like any
 * other action — never hand-rolled pending/error state around a port call.
 */
export const signUpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-up'],
    call: (input: { name: string; email: string; password: string }) => auth.signUp(input),
  });

export const signInMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in'],
    call: (input: { email: string; password: string }) => auth.signIn(input),
  });

export const requestMagicLinkMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'magic-link'],
    call: (input: { email: string; callbackURL: string; language?: string }) => auth.requestMagicLink(input),
  });

export const requestPasswordResetMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'request-password-reset'],
    call: (input: { email: string; language?: string }) => auth.requestPasswordReset(input),
  });

export const resetPasswordMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, { token: string; newPassword: string }> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'reset-password'],
    call: (input: { token: string; newPassword: string }) => auth.resetPassword(input),
  });

export const signOutMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-out'],
    call: () => auth.signOut(),
  });

export const registerPasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'register-passkey'],
    call: (input: { name: string }) => auth.registerPasskey(input.name),
  });

export const signInWithPasskeyMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-passkey'],
    call: () => auth.signInWithPasskey(),
  });

export const enableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'enable-two-factor'],
    call: (input: { password: string }) => auth.enableTwoFactor(input.password),
  });

export const verifyTotpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'verify-totp'],
    call: (input: { code: string }) => auth.verifyTotp(input.code),
  });

export const signInWithGoogleMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in-google'],
    call: () => auth.signInWithGoogle(),
  });
