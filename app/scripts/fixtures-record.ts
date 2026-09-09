import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createCliAuthAdapter, createBetterAuthClientAdapter } from '#adapters/auth/client-adapter.js';
import { createApiClient, meQuery, type ApiClient } from '#core/client/index.js';
import { SMOKE_TENANT_MEMBER_EMAIL, consentDefinitionSchema, marketingConsentSchema, deriveConsentState, tenantSettingsSchema, tenantSchema, type AppError } from '#core/domain/index.js';
import { tenants, tenantDocuments, tenantDocumentVersions, unsubscribeTokens, consentDefinitions, consentDefinitionVersions, marketingConsents, suppressions, consentConfirmationTokens } from '#adapters/db/schema.js';
import { canonicalJson, fixtureKey, fixtureSchema, type Fixture } from '../apps/web/src/stories/fixture-key.js';
import { renderConfirmationPage, renderPreferencesPage } from '../apps/server/src/public-marketing-pages.js';
import { SCREENS, domainChecklistRouting } from './visual-screen-inventory.js';
import { bootServer, ephemeralPort, killServer, rootDir } from './server-harness.js';
import { baseDatabaseUrl, smokeDatabaseUrl, setupDatabase, migrateAndSeed, dropDatabase } from './smoke-database.js';

import { abortVisualMutation, visualSeedTime as seedTime } from './visual-request-policy.js';
import { recordMarketingDirectoryFixtures, normalizeMarketingDirectoryFixture } from './fixtures-marketing-directory.js';
const passkeyRecorders = new Map<string, () => Promise<unknown>>();
const sessions = new Map<string, ApiClient>();
const staffMemberIds = new Map<string, string>();
const output = process.argv[2] ?? join(rootDir, 'apps/web/src/stories/fixtures');
const abortedApi = createApiClient({ baseUrl: '', fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
const success = z.object({ ok: z.literal(true), value: z.unknown() });
const save = (name: string, data: unknown): void => {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${name}.json`), `${JSON.stringify(JSON.parse(canonicalJson(data)), null, 2)}\n`);
};
const login = async (baseUrl: string, email: string, tenant: string): Promise<ApiClient> => {
  if (email === 'anonymous') return createApiClient({ baseUrl, headers: () => ({ 'X-Tenant': tenant }) });
  const previous = sessions.get(`${tenant}:${email}`);
  if (previous) return previous;
  let token: string | null = null;
  const auth = createCliAuthAdapter(baseUrl, (value) => { token = value; }, () => token);
  if (tenant === 'studio' && email !== 'creator@together.dev') {
    const requested = await auth.requestMagicLink({ email, callbackURL: `${baseUrl}/start` });
    if (!requested.ok) throw new Error(requested.error.message);
    const result = await createApiClient({ baseUrl }).devMagicLink(email);
    if (!result.ok || result.value.magicLink === null) throw new Error('Missing seeded member magic link');
    const verified = await auth.verifyMagicLinkToken(result.value.magicLink.token);
    if (!verified.ok) throw new Error(verified.error.message);
  } else {
    const signedIn = await auth.signIn({ email, password: 'demo-password-15' });
    if (!signedIn.ok) throw new Error(signedIn.error.message);
  }
  if (token === null) throw new Error('Missing seeded member session token');
  const api = createApiClient({ baseUrl, headers: () => ({ Authorization: `Bearer ${token}`, 'X-Tenant': tenant }) });
  const browserAuth = createBetterAuthClientAdapter(baseUrl, { Authorization: `Bearer ${token}` });
  passkeyRecorders.set(`${tenant}:${email}`, browserAuth.listPasskeys);
  sessions.set(`${tenant}:${email}`, api);
  return api;
};

type Scenario = { name: string; principal: string; tenant: string; page: string; route?: string; extra?: (api: ApiClient) => Promise<void>; courseId: string; lessonId: string; spaceId: string; pending?: Fixture['pending']; expectedErrors?: Record<string, AppError['code']> };
const plan: Scenario[] = [
  ...(['login', 'register', 'forgot-password', 'reset-password', 'reset-password-invalid'] as const).map((page) => ({ name: page, principal: 'anonymous', tenant: 'studio', page, route: page === 'reset-password' ? '/reset-password?token=visual-reset-token' : page === 'reset-password-invalid' ? '/reset-password?error=INVALID_TOKEN' : `/${page}`, courseId: '', lessonId: '', spaceId: '', extra: async (api: ApiClient) => { await api.publicNavigation(); if (page === 'login') { await api.authConfig(); await api.resolveSignInMethods({ email: 'creator@together.dev' }); } } })),
  { name: 'checkout', principal: 'anonymous', tenant: 'studio', page: 'checkout', route: '/checkout/product-studio-course-101', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.publicPaymentConfig(); await api.publicOffer(undefined, 'product-studio-course-101'); } },
  { name: 'boot-splash', principal: 'creator@together.dev', tenant: 'studio', page: 'boot-splash', route: '/panel', courseId: '', lessonId: '', spaceId: '', pending: [{ call: fixtureKey('me', []), queryKeys: [[...meQuery(abortedApi).queryKey]] }] },
  { name: 'course-not-found', principal: 'student.active@together.dev', tenant: 'studio', page: 'course-not-found', route: '/my/courses/course-does-not-exist', courseId: '', lessonId: '', spaceId: '', expectedErrors: { [fixtureKey('studentCourseStructure', ['course-does-not-exist'])]: 'not_found' }, extra: async (api) => { await api.studentCourseStructure('course-does-not-exist'); await api.studentProgress('course-does-not-exist'); await api.studentCourses(); } },
  { name: 'lesson-locked', principal: 'student.module@together.dev', tenant: 'studio', page: 'lesson-locked', route: '/my/courses/course-js/lessons/lesson-js-variables-2', courseId: '', lessonId: '', spaceId: '', expectedErrors: { [fixtureKey('studentLesson', ['lesson-js-variables-2'])]: 'forbidden' }, extra: async (api) => { await api.studentLesson('lesson-js-variables-2'); await api.studentLesson('lesson-js-dom-1'); await api.studentCourseStructure('course-js'); await api.studentProgress('course-js'); } },
  ...(['start', 'lesson'] as const).map((page) => ({ name: `acme-${page}`, principal: SMOKE_TENANT_MEMBER_EMAIL, tenant: 'acme', page, courseId: 'course-acme', lessonId: 'lesson-acme-intro', spaceId: '' })),
  ...(['start', 'space-feed', 'lesson'] as const).map((page) => ({ name: page, principal: 'student.active@together.dev', tenant: 'studio', page, courseId: 'course-js', lessonId: 'lesson-js-variables-1', spaceId: 'space-studio-community' })),
  { name: 'account', principal: 'student.active@together.dev', tenant: 'studio', page: 'account', route: '/account', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.listMemberBillingOrders(1, 25); await api.getTenantSettings(); await api.getMyErasureRequest(); await api.listAccountSessions(); } },
  { name: 'community', principal: 'student.active@together.dev', tenant: 'studio', page: 'community', route: '/community', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.listSpaces(); } },
  { name: 'course', principal: 'student.active@together.dev', tenant: 'studio', page: 'course', route: '/my/courses/course-js', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.studentProgress('course-js'); await api.studentCourses(); } },
  { name: 'my-courses', principal: 'student.active@together.dev', tenant: 'studio', page: 'my-courses', route: '/my', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.studentCourses(); } },
  { name: 'my-products', principal: 'student.active@together.dev', tenant: 'studio', page: 'my-products', route: '/my/products', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.myProducts(); await api.getTenantSettings(); } },
  { name: 'product-stub', principal: 'student.active@together.dev', tenant: 'studio', page: 'product-stub', route: '/my/course/product-js-full', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.myProducts(); await api.studentCourses(); } },
  { name: 'search', principal: 'student.active@together.dev', tenant: 'studio', page: 'search', route: '/search', courseId: 'course-js', lessonId: '', spaceId: '', extra: async (api) => { await api.studentCourseStructure('course-js'); await api.studentCourseStructure('course-react'); await api.searchPosts({ query: 'lesson' }); } },
  { name: 'anon-home-branded', principal: 'anonymous', tenant: 'akademia', page: 'anon-home-branded', route: '/', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.publicNavigation(); } },
  { name: 'anon-home-tiles', principal: 'anonymous', tenant: 'studio', page: 'anon-home-tiles', route: '/', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.publicNavigation(); await api.publicSpaceFeed({ spaceId: 'space-studio-community' }); } },
  { name: 'anon-course', principal: 'anonymous', tenant: 'studio', page: 'anon-course', route: '/my/courses/course-js', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.publicNavigation(); await api.publicCourseStructure('course-js'); } },
  { name: 'panel-dashboard', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-dashboard', route: '/panel', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listProducts(); await api.listCourses(); await api.listMembers(); await api.salesSummary(); await api.getOnboarding(); await api.getTenantSetupReadiness(); } },
  { name: 'panel-spaces', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-spaces', route: '/panel/spaces', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listStaffSpaces(); } },
  { name: 'panel-products', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-products', route: '/panel/products', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listProducts(); await api.listProductAccessIssues(); await api.listStaffSpaces(); const products = await api.listProducts(); if (products.ok) for (const product of products.value.products.filter((entry) => !entry.published)) { await api.listProductPrices(product.id); if (product.type === 'digital_download') await api.listProductDownloadAssets(product.id); } } },
  { name: 'panel-product-downloads', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-product-downloads', route: '/panel/products/product-download-workbook', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listProducts(); await api.listProductPrices('product-download-workbook'); await api.listProductDownloadAssets('product-download-workbook'); await api.listCourses(); await api.listModules(); await api.listLessons(); await api.listMarketingConsentDefinitions(); } },
  { name: 'panel-course', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-course', route: '/panel/courses/course-js', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listCourses(); await api.listModules(); await api.listLessons(); await api.listContentHistory({ courseId: 'course-js' }); } },
  { name: 'panel-lesson-attachments', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-lesson-attachments', route: '/panel/lessons/lesson-js-variables-1', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listLessons(); await api.listTenantSecrets(); await api.lessonReferences('lesson-js-variables-1'); await api.listLessonAttachments('lesson-js-variables-1'); } },
  { name: 'panel-coupons', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-coupons', route: '/panel/sales/coupons', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listCouponStats({}); } },
  { name: 'panel-coupon-create', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-coupon-create', route: '/panel/sales/coupons/new', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listProducts(); } },
  { name: 'panel-coupon-detail', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-coupon-detail', route: '/panel/sales/coupons/coupon-studio-partner20', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getCouponStats('coupon-studio-partner20'); } },
  { name: 'panel-order-detail', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-order-detail', route: '/panel/sales/order-studio-active-js', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getOrder('order-studio-active-js'); } },
  { name: 'panel-settings-redirects', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-settings-redirects', route: '/panel/settings/redirects', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getTenantRedirects({ limit: 50, offset: 0 }); await api.listCourses(); await api.listModules(); await api.listLessons(); } },
  ...(['panel-settings-domains', 'panel-settings-domains-active', 'panel-settings-domains-verified'] as const).map((name) => ({ name, principal: 'creator@together.dev', tenant: 'studio', page: name, route: '/panel/settings', courseId: '', lessonId: '', spaceId: '', extra: async (api: ApiClient) => { await api.listStaffSpaces(); await api.listCourses(); await api.getTenantRedirects({ limit: 0 }); await api.getTenantSettings(); await api.getTenantRouting(); await api.listAccountSessions(); } })),
  { name: 'panel-settings-security', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-settings-security', route: '/panel/settings#security', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getTenantSettings(); await api.getTenantRouting(); await api.listAccountSessions(); } },
  { name: 'panel-storage-wizard', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-storage-wizard', route: '/panel/integrations#storage', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listTenantSecrets(); await api.getTenantRouting(); } },
  { name: 'panel-integrations-email', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-integrations-email', route: '/panel/integrations#email', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getMarketingSesSettings(); await api.getMarketingReputation(); } },
  { name: 'panel-marketing-campaigns', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-campaigns', route: '/panel/marketing/campaigns', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMarketingCampaigns(); await api.listMarketingConsentDefinitions(); await api.getMarketingReputation(); } },
  { name: 'panel-marketing-activity', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-activity', route: '/panel/marketing/activity', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listTenantSchedulerRuns({ limit: 25 }); } },
  { name: 'panel-marketing-activity-detail', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-activity-detail', route: '/panel/marketing/activity/scheduler-run-studio-outbox', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getTenantSchedulerRun('scheduler-run-studio-outbox'); } },
  { name: 'panel-marketing-sends', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-sends', route: '/panel/marketing/sends', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMarketingCampaigns(); await api.listEmailSends({ limit: 25 }); } },
  { name: 'panel-marketing-send-detail', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-send-detail', route: '/panel/marketing/sends/marketing/send-studio-marketing', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.getEmailSend('marketing', 'send-studio-marketing'); } },
  { name: 'panel-marketing-consents', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-consents', route: '/panel/marketing/consents', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMarketingConsentDefinitions(); } },
  { name: 'panel-marketing-documents', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-documents', route: '/panel/marketing/documents', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMarketingDocuments(); } },
  { name: 'panel-marketing-layouts', principal: 'creator@together.dev', tenant: 'studio', page: 'panel-marketing-layouts', route: '/panel/marketing/layouts', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMarketingLayouts(); } },
  { name: 'member-detail', principal: 'creator@together.dev', tenant: 'studio', page: 'member-detail', route: '/panel/members/member-studio-active', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMembers(); await api.listProducts(); await api.getTenantSettings(); await api.listMemberGrants('member-studio-active'); await api.memberCommerce('member-studio-active'); await api.memberTimeline('member-studio-active'); await api.memberLearningSummary('member-studio-active'); } },
  { name: 'member-email-timeline', principal: 'creator@together.dev', tenant: 'studio', page: 'member-email-timeline', route: '/panel/members/member-studio-active', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.listMembers(); await api.listProducts(); await api.getTenantSettings(); await api.listMemberGrants('member-studio-active'); await api.memberCommerce('member-studio-active'); await api.memberTimeline('member-studio-active'); await api.memberLearningSummary('member-studio-active'); await api.listMemberEmailSends('member-studio-active'); } },
  { name: 'start-menu-sheet', principal: 'student.active@together.dev', tenant: 'studio', page: 'start-menu-sheet', route: '/start', courseId: '', lessonId: '', spaceId: '', extra: async (api) => { await api.studentCourses(); await api.memberHomeFeed({ limit: 10 }); await api.listUpcomingEvents({ limit: 4 }); await api.listUpcomingEvents({ limit: 20 }); await api.studentCourseStructure('course-js'); await api.studentProgress('course-js'); } },
];
const record = async (api: ApiClient, scenario: Scenario, baseUrl: string): Promise<void> => {
  const calls: Record<string, unknown> = {};
  const validateResult = (method: string, args: unknown[], result: unknown): void => {
    const expectedCode = scenario.expectedErrors?.[fixtureKey(method, args)];
    if (expectedCode !== undefined) {
      z.object({ ok: z.literal(false), error: z.object({ code: z.literal(expectedCode) }) }).parse(result);
    } else if (!abortVisualMutation(method) && !(scenario.principal === 'anonymous' && method === 'me')) {
      success.parse(result);
    }
  };
  const call = async <T>(method: keyof ApiClient, args: unknown[], invoke: () => Promise<T>): Promise<T> => {
    const result = await invoke();
    validateResult(method, args, result);
    calls[fixtureKey(method, args)] = result;
    return result;
  };
  const me = await call('me', [], () => api.me());
  if (!me.ok && scenario.principal !== 'anonymous') throw new Error(me.error.message);
  const recordedUserId = me.ok ? me.value.userId : null;
  const fixtureUserId = me.ok ? `fixture-user-${createHash('sha256').update(me.value.email).digest('hex').slice(0, 16)}` : null;
  if (me.ok && me.value.tenant?.staffRole && me.value.tenant.memberId) {
    staffMemberIds.set(me.value.tenant.memberId, `fixture-member-${createHash('sha256').update(`${me.value.tenant.id}:${me.value.email}`).digest('hex').slice(0, 16)}`);
  }
  await call('publicOffer', [], () => api.publicOffer());
  if (scenario.principal !== 'anonymous' && scenario.principal !== 'creator@together.dev') {
  await call('memberNavigation', [], () => api.memberNavigation());
  await call('unreadNotificationCount', [], () => api.unreadNotificationCount());
  await call('unreadMessageCount', [], () => api.unreadMessageCount());
  }
  if (scenario.principal === 'creator@together.dev' || scenario.page === 'lesson' || scenario.page === 'lesson-locked') {
    await call('getTenantSettings', [], () => api.getTenantSettings());
  }
  if (scenario.principal === 'creator@together.dev') {
    await call('unreadNotificationCount', [], () => api.unreadNotificationCount());
    await call('listReports', [{ status: 'open', limit: 1 }], () => api.listReports({ status: 'open', limit: 1 }));
    await call('listDmReports', [{ status: 'open', limit: 1 }], () => api.listDmReports({ status: 'open', limit: 1 }));
  }
  const { courseId, lessonId, spaceId } = scenario;
  let route = scenario.route ?? '/start';
  if (['start', 'lesson', 'course'].includes(scenario.page)) {
    await call('studentCourseStructure', [courseId], () => api.studentCourseStructure(courseId));
  }
  if (scenario.page === 'start') {
    await call('studentProgress', [courseId], () => api.studentProgress(courseId));
    await call('studentCourses', [], () => api.studentCourses());
    await call('memberHomeFeed', [{ limit: 10 }], () => api.memberHomeFeed({ limit: 10 }));
    await call('listUpcomingEvents', [{ limit: 4 }], () => api.listUpcomingEvents({ limit: 4 }));
    await call('listUpcomingEvents', [{ limit: 20 }], () => api.listUpcomingEvents({ limit: 20 }));
  }
  if (scenario.page === 'lesson') {
    route = `/my/courses/${courseId}/lessons/${lessonId}`;
    await call('studentLesson', [lessonId], () => api.studentLesson(lessonId));
    await call('studentLessonAttachments', [lessonId], () => api.studentLessonAttachments(lessonId));
    await call('studentProgress', [courseId], () => api.studentProgress(courseId));
    const discussion = { contextKind: 'lesson' as const, contextId: lessonId, limit: 20 };
    await call('discussion', [discussion], () => api.discussion(discussion));
    if (scenario.tenant === 'studio') await call('studentLesson', ['lesson-js-variables-2'], () => api.studentLesson('lesson-js-variables-2'));
    const input = { courseId, lessonId, moduleId: scenario.tenant === 'studio' ? 'module-js-basics' : 'module-acme-1', chapterId: scenario.tenant === 'studio' ? 'chapter-js-variables' : 'chapter-acme-1' };
    await call('updateLastViewed', [input], () => abortedApi.updateLastViewed(input));
  }
  if (scenario.page === 'space-feed') {
    route = `/community/${spaceId}`;
    await call('listSpaces', [], () => api.listSpaces());
    await call('spaceFeed', [{ spaceId }], () => api.spaceFeed({ spaceId }));
    await call('listUpcomingEvents', [{ limit: 20 }], () => api.listUpcomingEvents({ limit: 20 }));
    const input = { spaceId, scope: 'upcoming' as const, limit: 5 };
    await call('listSpaceEvents', [input], () => api.listSpaceEvents(input));
    const pastInput = { spaceId, scope: 'past' as const, limit: 5 };
    await call('listSpaceEvents', [pastInput], () => api.listSpaceEvents(pastInput));
    await call('markSpaceSeen', [{ spaceId }], () => abortedApi.markSpaceSeen({ spaceId }));
  }
  if (scenario.extra) {
    const recordingApi = new Proxy(api, {
      get: (target, property) => (...args: unknown[]) => {
        const method: unknown = Reflect.get(abortVisualMutation(String(property)) ? abortedApi : target, property);
        if (typeof method !== 'function') throw new Error(`Invalid recording method ${String(property)}`);
        return Promise.resolve(Reflect.apply(method, target, args)).then((result: unknown) => {
          validateResult(String(property), args, result);
          if (property === 'listAccountSessions') {
            const parsed = z.object({ ok: z.literal(true), value: z.object({ sessions: z.array(z.object({ current: z.boolean(), userAgent: z.string().nullable() })) }) }).parse(result);
            result = { ok: true, value: { sessions: parsed.value.sessions.map((session, index) => ({ ...session, id: `fixture-session-${index}`, createdAt: seedTime, lastActiveAt: seedTime })) } };
          }
          calls[fixtureKey(String(property), args)] = result;
          return result;
        });
      },
    });
    await scenario.extra(recordingApi);
  }
  if (scenario.page === 'account' || scenario.page.startsWith('panel-settings-') && scenario.page !== 'panel-settings-redirects') {
    const recordPasskeys = passkeyRecorders.get(`${scenario.tenant}:${scenario.principal}`);
    if (!recordPasskeys) throw new Error('Missing passkey recorder');
    calls[fixtureKey('listPasskeys', [])] = await recordPasskeys();
  }
  // Both inherited DNS goldens captured the pending response cached by the live app.
  if (scenario.page.startsWith('panel-settings-domains')) {
    calls[fixtureKey('getTenantRouting', [])] = { ok: true, value: { routing: domainChecklistRouting(scenario.page.endsWith('-verified')) } };
  }
  // Routing goldens include the authoring server's port in CORS instructions.
  const recordedTenantHost = `${scenario.tenant}.localhost:${new URL(baseUrl).port}`;
  const goldenTenantHost = `${scenario.tenant}.localhost:63871`;
  const snapshot: unknown = JSON.parse(JSON.stringify({ scenario: scenario.name, principal: scenario.principal, tenant: scenario.tenant, route, calls, ...(scenario.pending ? { pending: scenario.pending } : {}), ...(scenario.expectedErrors ? { expectedErrors: scenario.expectedErrors } : {}) }, (_key, value: unknown) => value === recordedUserId ? fixtureUserId : typeof value === 'string' ? staffMemberIds.get(value) ?? value.replaceAll(baseUrl, 'http://localhost:48730').replaceAll(recordedTenantHost, goldenTenantHost) : value));
  fixtureSchema.parse(snapshot);
  save(scenario.name, scenario.page === 'marketing-directory' ? normalizeMarketingDirectoryFixture(snapshot) : snapshot);
  console.log(`${scenario.name}: ${Object.keys(calls).length} calls`);
};

let server: ChildProcess | undefined;
try {
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(smokeDatabaseUrl, { SEED_BASE_TIME: seedTime });
  const port = await ephemeralPort();
  const baseUrl = `http://localhost:${port}`;
  server = await bootServer({ port, healthUrl: `${baseUrl}/api/health`, env: { DATABASE_URL: smokeDatabaseUrl, TOGETHER_VISUAL_CLOCK: seedTime, APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost', PAYMENT_PROVIDER: 'fake', EMAIL_PROVIDER: 'dev', SIMULATED_PAYMENTS: 'true', AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true', CRON_SECRET: 'directory-fixture-worker-secret' } });
  for (const scenario of (process.env['FIXTURE_GROUP'] === 'marketing-directory' ? [] : plan)) await record(await login(baseUrl, scenario.principal, scenario.tenant), scenario, baseUrl);
  await recordMarketingDirectoryFixtures(await login(baseUrl, 'creator@together.dev', 'studio'), async () => {
    const response = await fetch(`${baseUrl}/api/internal/marketing/imports/tick`, { headers: { Authorization: 'Bearer directory-fixture-worker-secret' } });
    if (!response.ok) throw new Error(`Directory fixture worker failed: ${await response.text()}`);
  }, async (name, route, extra, expectedErrors) => record(await login(baseUrl, 'creator@together.dev', 'studio'), { name, route, extra, ...(expectedErrors ? { expectedErrors } : {}), page: 'marketing-directory', principal: 'creator@together.dev', tenant: 'studio', courseId: '', lessonId: '', spaceId: '' }, baseUrl));
  const pool = new pg.Pool({ connectionString: smokeDatabaseUrl });
  try {
    const db = drizzle(pool);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, 'tenant-akademia'));
    const [document] = await db.select().from(tenantDocuments).where(eq(tenantDocuments.id, 'document-akademia-privacy'));
    const [version] = await db.select().from(tenantDocumentVersions).where(eq(tenantDocumentVersions.id, 'document-akademia-privacy-v1'));
    if (!tenant || !document || !version || !version.publishedAt) throw new Error('Missing legal seed');
    save('hosted-legal-document', { nonce: 'storybook', brand: { tenant: tenantSchema.parse(tenant), settings: tenantSettingsSchema.parse(tenant) }, language: 'en', path: `/legal/${document.slug}/v/${version.version}`, title: document.title, content: version.content, immutableVersion: { version: version.version, publishedAt: version.publishedAt } });
    const common = { nonce: 'storybook', brand: { tenant: tenantSchema.parse(tenant), settings: tenantSettingsSchema.parse(tenant) }, language: 'en' as const };
    const [token] = await db.select().from(unsubscribeTokens).where(and(eq(unsubscribeTokens.tenantId, tenant.id), eq(unsubscribeTokens.id, 'unsubscribe-akademia-visual')));
    if (!token) throw new Error('Missing unsubscribe seed');
    const suppressionRows = await db.select().from(suppressions).where(eq(suppressions.tenantId, tenant.id));
    if (suppressionRows.length !== 0) throw new Error('Preference recording requires the unsuppressed seed');
    const definitionRows = await db.select().from(consentDefinitions).where(and(eq(consentDefinitions.tenantId, tenant.id), eq(consentDefinitions.status, 'active'), eq(consentDefinitions.kind, 'optional_marketing'))).orderBy(asc(consentDefinitions.key));
    const definitions = await Promise.all(definitionRows.map(async (row) => {
      const versions = await db.select().from(consentDefinitionVersions).where(and(eq(consentDefinitionVersions.tenantId, tenant.id), eq(consentDefinitionVersions.definitionId, row.id))).orderBy(asc(consentDefinitionVersions.version));
      const consents = await db.select().from(marketingConsents).where(and(eq(marketingConsents.tenantId, tenant.id), eq(marketingConsents.email, token.email), eq(marketingConsents.definitionId, row.id)));
      const state = deriveConsentState(consents.map((consent) => marketingConsentSchema.parse({ ...consent, occurredAt: new Date(consent.occurredAt).toISOString() })), consentDefinitionSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }));
      return { id: row.id, label: versions.at(-1)?.label ?? row.key, active: state.active, pendingConfirmation: state.state === 'pending_confirmation' };
    }));
    const preferences = { ...common, token: token.token, email: token.email, scope: token.scope, scopeLabel: definitions.find((definition) => token.scope === `consent:${definition.id}`)?.label ?? null, globallySuppressed: false, definitions };
    const verifyHtml = async (name: string, html: string): Promise<void> => {
      const screen = SCREENS.find((entry) => entry.name === name);
      if (!screen) throw new Error(`Missing server HTML screen ${name}`);
      const response = await fetch(`${baseUrl}${screen.path}`, { headers: { 'X-Tenant': tenant.slug } });
      if (!response.ok || await response.text() !== html) throw new Error(`Recorded inputs do not reproduce ${name}`);
    };
    await verifyHtml('marketing-preferences', renderPreferencesPage(preferences));
    save('marketing-preferences', preferences);
    for (const expectedState of ['success', 'expired'] as const) {
      const name = `marketing-confirmation-${expectedState}`;
      const screen = SCREENS.find((entry) => entry.name === name);
      if (!screen) throw new Error(`Missing server HTML screen ${name}`);
      const path = new URL(screen.path, baseUrl).pathname;
      const confirmationToken = path.split('/').at(-1);
      if (!confirmationToken) throw new Error('Missing confirmation token');
      const [confirmation] = await db.select().from(consentConfirmationTokens).where(and(eq(consentConfirmationTokens.tenantId, tenant.id), eq(consentConfirmationTokens.token, confirmationToken)));
      const state = !confirmation || (confirmation.usedAt === null && Date.parse(confirmation.expiresAt) <= Date.parse(seedTime)) ? 'expired' : confirmation.usedAt === null ? 'prompt' : 'success';
      if (state !== expectedState) throw new Error(`Unexpected seeded confirmation state for ${name}`);
      const input = { ...common, path, state: expectedState };
      await verifyHtml(name, renderConfirmationPage(input));
      save(name, input);
    }
  } finally { await pool.end(); }
} finally {
  if (server) await killServer(server);
  await dropDatabase(baseDatabaseUrl);
}
