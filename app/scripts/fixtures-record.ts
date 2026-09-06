import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createCliAuthAdapter } from '#adapters/auth/client-adapter.js';
import { createApiClient, type ApiClient } from '#core/client/index.js';
import { SMOKE_TENANT_MEMBER_EMAIL, tenantSettingsSchema, tenantSchema } from '#core/domain/index.js';
import { tenants, tenantDocuments, tenantDocumentVersions } from '#adapters/db/schema.js';
import { canonicalJson, fixtureKey } from '../apps/web/src/stories/fixture-key.js';
import { bootServer, ephemeralPort, killServer, rootDir } from './server-harness.js';
import { baseDatabaseUrl, smokeDatabaseUrl, setupDatabase, migrateAndSeed, dropDatabase } from './smoke-database.js';

import { abortVisualMutation, visualSeedTime as seedTime } from './visual-request-policy.js';
const output = process.argv[2] ?? join(rootDir, 'apps/web/src/stories/fixtures');
const abortedApi = createApiClient({ baseUrl: '', fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) });
const success = z.object({ ok: z.literal(true), value: z.unknown() });
const save = (name: string, data: unknown): void => {
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${name}.json`), `${JSON.stringify(JSON.parse(canonicalJson(data)), null, 2)}\n`);
};
const login = async (baseUrl: string, email: string, tenant: string): Promise<ApiClient> => {
  let token: string | null = null;
  const auth = createCliAuthAdapter(baseUrl, (value) => { token = value; }, () => token);
  if (tenant === 'studio') {
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
  return createApiClient({ baseUrl, headers: () => ({ Authorization: `Bearer ${token}`, 'X-Tenant': tenant }) });
};

type Scenario = { name: string; principal: string; tenant: string; page: 'start' | 'lesson' | 'space-feed'; courseId: string; lessonId: string; spaceId: string };
const plan: Scenario[] = [
  ...(['start', 'lesson'] as const).map((page) => ({ name: `acme-${page}`, principal: SMOKE_TENANT_MEMBER_EMAIL, tenant: 'acme', page, courseId: 'course-acme', lessonId: 'lesson-acme-intro', spaceId: '' })),
  ...(['start', 'space-feed', 'lesson'] as const).map((page) => ({ name: page, principal: 'kursant.aktywny@together.dev', tenant: 'studio', page, courseId: 'course-js', lessonId: 'lesson-js-zmienne-1', spaceId: 'space-studio-spolecznosc' })),
];
const record = async (api: ApiClient, scenario: Scenario): Promise<void> => {
  const calls: Record<string, unknown> = {};
  const call = async <T>(method: keyof ApiClient, args: unknown[], invoke: () => Promise<T>): Promise<T> => {
    const result = await invoke();
    if (!abortVisualMutation(method)) success.parse(result);
    calls[fixtureKey(method, args)] = result;
    return result;
  };
  const me = await call('me', [], () => api.me());
  if (!me.ok) throw new Error(me.error.message);
  const recordedUserId = me.value.userId;
  const fixtureUserId = `fixture-user-${createHash('sha256').update(me.value.email).digest('hex').slice(0, 16)}`;
  await call('publicOffer', [], () => api.publicOffer());
  await call('memberNavigation', [], () => api.memberNavigation());
  await call('unreadNotificationCount', [], () => api.unreadNotificationCount());
  await call('unreadMessageCount', [], () => api.unreadMessageCount());
  const { courseId, lessonId, spaceId } = scenario;
  let route = '/start';
  if (scenario.page !== 'space-feed') {
    await call('studentCourseStructure', [courseId], () => api.studentCourseStructure(courseId));
  }
  if (scenario.page === 'start') {
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
    if (scenario.tenant === 'studio') await call('studentLesson', ['lesson-js-zmienne-2'], () => api.studentLesson('lesson-js-zmienne-2'));
    const input = { courseId, lessonId, moduleId: scenario.tenant === 'studio' ? 'module-js-podstawy' : 'module-acme-1', chapterId: scenario.tenant === 'studio' ? 'chapter-js-zmienne' : 'chapter-acme-1' };
    await call('updateLastViewed', [input], () => abortedApi.updateLastViewed(input));
  }
  if (scenario.page === 'space-feed') {
    route = `/community/${spaceId}`;
    await call('listSpaces', [], () => api.listSpaces());
    await call('spaceFeed', [{ spaceId }], () => api.spaceFeed({ spaceId }));
    await call('listUpcomingEvents', [{ limit: 20 }], () => api.listUpcomingEvents({ limit: 20 }));
    const input = { spaceId, scope: 'upcoming' as const, limit: 5 };
    await call('listSpaceEvents', [input], () => api.listSpaceEvents(input));
    await call('markSpaceSeen', [{ spaceId }], () => abortedApi.markSpaceSeen({ spaceId }));
  }
  const snapshot: unknown = JSON.parse(JSON.stringify({ scenario: scenario.name, principal: scenario.principal, tenant: scenario.tenant, route, calls }, (_key, value: unknown) => value === recordedUserId ? fixtureUserId : value));
  save(scenario.name, snapshot);
  console.log(`${scenario.name}: ${Object.keys(calls).length} calls`);
};

let server: ChildProcess | undefined;
try {
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(smokeDatabaseUrl, { SEED_BASE_TIME: seedTime });
  const port = await ephemeralPort();
  const baseUrl = `http://localhost:${port}`;
  server = await bootServer({ port, healthUrl: `${baseUrl}/api/health`, env: { DATABASE_URL: smokeDatabaseUrl, TOGETHER_VISUAL_CLOCK: seedTime, APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost', PAYMENT_PROVIDER: 'fake', EMAIL_PROVIDER: 'dev', SIMULATED_PAYMENTS: 'true', AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true' } });
  for (const scenario of plan) await record(await login(baseUrl, scenario.principal, scenario.tenant), scenario);
  const pool = new pg.Pool({ connectionString: smokeDatabaseUrl });
  try {
    const db = drizzle(pool);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, 'tenant-akademia'));
    const [document] = await db.select().from(tenantDocuments).where(eq(tenantDocuments.id, 'document-akademia-privacy'));
    const [version] = await db.select().from(tenantDocumentVersions).where(eq(tenantDocumentVersions.id, 'document-akademia-privacy-v1'));
    if (!tenant || !document || !version || !version.publishedAt) throw new Error('Missing legal seed');
    save('hosted-legal-document', { nonce: 'storybook', brand: { tenant: tenantSchema.parse(tenant), settings: tenantSettingsSchema.parse(tenant) }, language: 'pl', path: `/legal/${document.slug}/v/${version.version}`, title: document.title, content: version.content, immutableVersion: { version: version.version, publishedAt: version.publishedAt } });
  } finally { await pool.end(); }
} finally {
  if (server) await killServer(server);
  await dropDatabase(baseDatabaseUrl);
}
