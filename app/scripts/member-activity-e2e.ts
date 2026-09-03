import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { ZodTypeAny, output } from 'zod';

import { DM_REPORT_SNAPSHOT_SIZE } from '#core/domain/index.js';

import {
  API_PATHS,
  dmReportsListOutputSchema,
  eventIcsOutputSchema,
  eventOutputSchema,
  looseEnvelopeSchema,
  messagesListOutputSchema,
  messagesUnreadOutputSchema,
  notificationsListOutputSchema,
  notificationsReadAllOutputSchema,
  notificationsUnreadOutputSchema,
} from '#core/contract/index.js';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import { requestMagicLink, signInWithPassword } from './login-flow.js';
import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_member_activity';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();

const studioSpaceId = 'space-studio-spolecznosc';
const freeMemberPostId = 'post-spolecznosc-polecajki';
const eventTitle = 'E2E Live Clinic';
const eventDescription = 'Deterministic member activity event';
const eventLocation = 'E2E Studio';
const eventUrl = 'https://example.com/e2e-live-clinic';
const liveEmbedUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const firstMessage = 'E2E hello from member A';
const replies = [
  'E2E reply one from member B',
  'E2E reply two from member B',
  'E2E reply three from member B',
];

class E2eFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new E2eFailure(message);
}

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB}`);
  } catch (cause) {
    throw new E2eFailure(
      `Could not prepare the member-activity database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const migrateSeedAndActivateMembers = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const activated = await client.query(
      'UPDATE members SET banned_at = NULL, banned_reason = NULL, banned_by_user_id = NULL WHERE tenant_id = $1 AND id = $2',
      ['tenant-studio', 'member-studio-free'],
    );
    assert(activated.rowCount === 1, `Expected to activate one member, updated ${String(activated.rowCount)}`);
  } finally {
    await client.end();
  }
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const readJson = (raw: string, label: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new E2eFailure(`${label}: expected JSON.\n${raw}`);
  }
};

interface BrowserResponse {
  status: number;
  raw: string;
}

const browserRequest = async (
  page: Page,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<BrowserResponse> =>
  page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        credentials: 'same-origin',
        headers: requestInit.body === undefined ? {} : { 'content-type': 'application/json' },
      });
      return { status: response.status, raw: await response.text() };
    },
    { requestPath: path, requestInit: init },
  );

const requestOk = async <S extends ZodTypeAny>(
  page: Page,
  path: string,
  label: string,
  schema: S,
  init?: { method?: string; body?: string },
): Promise<output<S>> => {
  const response = await browserRequest(page, path, init);
  assert(response.status >= 200 && response.status < 300, `${label}: HTTP ${response.status}.\n${response.raw}`);
  const envelope = looseEnvelopeSchema.parse(readJson(response.raw, label));
  assert(envelope.ok, `${label}: expected an ok envelope.\n${response.raw}`);
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new E2eFailure(`${label}: response did not match its contract.\n${parsed.error.message}`);
  }
  return parsed.data;
};

const pollUntil = async (
  assertion: () => Promise<void>,
  label: string,
  timeoutMs = 15000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (cause) {
      lastError = String(cause);
      await delay(100);
    }
  }
  throw new E2eFailure(`${label} timed out after ${String(timeoutMs)}ms.\n${lastError}`);
};

const setEnglish = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    window.localStorage.setItem('together-language', 'en');
  });
};

const signInCreator = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 15000 });
};

const signInMember = async (page: Page, baseUrl: string, email: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await requestMagicLink(page, email);
  const sent = page.getByTestId('magic-link-sent');
  await sent.waitFor({ state: 'visible', timeout: 15000 });
  const link = sent.locator('a[href]').first();
  await link.waitFor({ state: 'visible', timeout: 15000 });
  const href = await link.getAttribute('href');
  assert(href !== null && href.length > 0, `No development magic link was exposed for ${email}`);
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/(?:my|start)(?:[/?#]|$)/, { timeout: 15000 });
};

const createLiveEvent = async (creatorPage: Page) => {
  const startsAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const created = await requestOk(
    creatorPage,
    API_PATHS.eventsCreate,
    'create live event',
    eventOutputSchema,
    {
      method: 'POST',
      body: JSON.stringify({
        spaceId: studioSpaceId,
        title: eventTitle,
        description: eventDescription,
        startsAt,
        endsAt,
        location: eventLocation,
        url: eventUrl,
        liveEmbedUrl,
      }),
    },
  );
  assert(created.event.liveNow, 'Created event was not projected as live');
  assert(created.event.discussionRootPostId !== null, 'Created event did not get a discussion thread');
  return { event: created.event, startsAt, endsAt };
};

const icsTimestamp = (iso: string): string => `${iso.replaceAll(/[-:]/g, '').slice(0, 15)}Z`;

const runEventJourney = async (
  memberPage: Page,
  anonymousPage: Page,
  baseUrl: string,
  created: Awaited<ReturnType<typeof createLiveEvent>>,
): Promise<void> => {
  const { event, startsAt, endsAt } = created;
  await memberPage.goto(`${baseUrl}/start`, { waitUntil: 'domcontentloaded' });
  await memberPage.getByTestId(`live-now-${event.id}`).waitFor({ state: 'visible', timeout: 15000 });
  await memberPage.getByTestId(`live-now-badge-${event.id}`).waitFor({ state: 'visible' });

  const listed = await requestOk(
    memberPage,
    `${API_PATHS.notifications}?limit=100`,
    'member A event notifications',
    notificationsListOutputSchema,
  );
  const eventNotification = listed.notifications.find(
    (notification) => notification.kind === 'space-event' && notification.payload.eventId === event.id,
  );
  assert(eventNotification !== undefined, 'Member A did not receive the space-event notification');

  await memberPage.goto(`${baseUrl}/notifications`, { waitUntil: 'domcontentloaded' });
  await memberPage.getByTestId(`notification-open-${eventNotification.id}`).click();
  await memberPage.waitForURL(`**/community/${studioSpaceId}/events/${event.id}`, { timeout: 15000 });
  await memberPage.getByTestId('event-live-embed').waitFor({ state: 'visible', timeout: 15000 });
  assert(
    (await memberPage.getByTestId('event-going-count').textContent())?.includes('0') === true,
    'Event did not start with zero going RSVPs',
  );
  await memberPage.getByTestId('event-rsvp-going').click();
  await memberPage.getByTestId('event-rsvp-going').waitFor({ state: 'visible' });
  await pollUntil(async () => {
    assert(
      (await memberPage.getByTestId('event-rsvp-going').getAttribute('aria-pressed')) === 'true',
      'Going RSVP was not selected',
    );
    assert(
      (await memberPage.getByTestId('event-going-count').textContent())?.includes('1') === true,
      'Going count did not increment to one',
    );
  }, 'member A RSVP');

  const projected = await requestOk(
    memberPage,
    API_PATHS.eventGet.replace(':eventId', event.id),
    'member A event projection',
    eventOutputSchema,
  );
  assert(projected.event.viewerRsvp === 'going', 'Event API did not retain member A RSVP');
  assert(projected.event.goingCount === 1, `Event API going count was ${String(projected.event.goingCount)}`);

  const downloadPromise = memberPage.waitForEvent('download', { timeout: 15000 });
  await memberPage.getByTestId('event-ics').click();
  const download = await downloadPromise;
  assert(download.suggestedFilename() === `event-${event.id}.ics`, 'ICS download had the wrong filename');
  const ics = await requestOk(
    memberPage,
    API_PATHS.eventIcs.replace(':eventId', event.id),
    'event ICS',
    eventIcsOutputSchema,
  );
  for (const field of [
    'BEGIN:VEVENT',
    `UID:${event.id}@together`,
    `DTSTART:${icsTimestamp(startsAt)}`,
    `DTEND:${icsTimestamp(endsAt)}`,
    `SUMMARY:${eventTitle}`,
    `DESCRIPTION:${eventDescription}`,
    `LOCATION:${eventLocation}`,
    `URL:${eventUrl}`,
    'END:VEVENT',
  ]) {
    assert(ics.icsContent.includes(field), `ICS content did not include ${field}`);
  }

  const eventPath = `/community/${studioSpaceId}/events/${event.id}`;
  await anonymousPage.goto(`${baseUrl}${eventPath}`, { waitUntil: 'domcontentloaded' });
  await anonymousPage.getByTestId('public-event-page').waitFor({ state: 'visible', timeout: 15000 });
  await anonymousPage.getByTestId('public-event-sign-in').waitFor({ state: 'visible' });
  assert(await anonymousPage.getByTestId('event-rsvp').count() === 0, 'Anonymous event exposed RSVP controls');
  assert(await anonymousPage.getByTestId('message-composer').count() === 0, 'Anonymous event exposed a composer');
  assert(await anonymousPage.getByTestId('discussion-composer').count() === 0, 'Anonymous event exposed a discussion composer');

  const publicEvent = await requestOk(
    anonymousPage,
    API_PATHS.publicSpaceEvent.replace(':spaceId', studioSpaceId).replace(':eventId', event.id),
    'anonymous event JSON',
    eventOutputSchema,
  );
  assert(publicEvent.event.viewerRsvp === null, 'Anonymous event JSON exposed a viewer RSVP');
  console.log('member-activity-e2e: live event, notification, RSVP, ICS, and public boundary OK');
};

const sendMessage = async (page: Page, body: string): Promise<void> => {
  const input = page.getByTestId('message-composer-input');
  await input.fill(body);
  await page.getByTestId('message-composer-submit').click();
  await page.getByText(body, { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await pollUntil(async () => {
    assert(await input.inputValue() === '', `Composer did not reset after sending "${body}"`);
  }, `send message "${body}"`);
};

const runDirectMessageJourney = async (
  memberAPage: Page,
  memberBPage: Page,
  baseUrl: string,
): Promise<string> => {
  await memberAPage.goto(`${baseUrl}/community/${studioSpaceId}`, { waitUntil: 'domcontentloaded' });
  await memberAPage.getByTestId(`post-menu-${freeMemberPostId}`).waitFor({ state: 'visible', timeout: 15000 });
  await memberAPage.getByTestId(`post-menu-${freeMemberPostId}`).click();
  await memberAPage.getByTestId(`start-message-${freeMemberPostId}`).waitFor({ state: 'visible', timeout: 15000 });
  await memberAPage.getByTestId(`start-message-${freeMemberPostId}`).click();
  await memberAPage.getByTestId('conversation-page').waitFor({ state: 'visible', timeout: 15000 });
  const conversationId = new URL(memberAPage.url()).pathname.split('/').at(-1) ?? '';
  assert(conversationId.length > 0, 'Starting a DM did not open a conversation URL');
  await sendMessage(memberAPage, firstMessage);
  await memberAPage.getByTestId('conversation-back').click();
  await memberAPage.waitForURL('**/messages', { timeout: 15000 });
  await memberAPage.getByTestId(`conversation-row-${conversationId}`).waitFor({ state: 'visible', timeout: 15000 });

  await memberBPage.goto(`${baseUrl}/messages`, { waitUntil: 'domcontentloaded' });
  const memberBRow = memberBPage.getByTestId(`conversation-row-${conversationId}`);
  await memberBRow.waitFor({ state: 'visible', timeout: 15000 });
  const memberBConversations = await requestOk(
    memberBPage,
    `${API_PATHS.messagesList}?limit=100`,
    'member B conversations',
    messagesListOutputSchema,
  );
  const memberBConversation = memberBConversations.conversations.find(({ id }) => id === conversationId);
  assert(memberBConversation?.unread === true, 'Member B conversation row was not unread');
  const memberBUnread = await requestOk(
    memberBPage,
    API_PATHS.messagesUnread,
    'member B unread count',
    messagesUnreadOutputSchema,
  );
  assert(memberBUnread.unread === 1, `Member B unread count was ${String(memberBUnread.unread)}`);

  await memberBRow.click();
  await memberBPage.getByTestId('conversation-page').waitFor({ state: 'visible', timeout: 15000 });
  await sendMessage(memberBPage, replies[0] ?? '');
  await memberAPage
    .getByTestId(`conversation-row-${conversationId}`)
    .getByText(replies[0] ?? '', { exact: true })
    .waitFor({ state: 'visible', timeout: 15000 });
  await sendMessage(memberBPage, replies[1] ?? '');
  await sendMessage(memberBPage, replies[2] ?? '');
  await memberAPage
    .getByTestId(`conversation-row-${conversationId}`)
    .getByText(replies[2] ?? '', { exact: true })
    .waitFor({ state: 'visible', timeout: 15000 });

  const memberANotifications = await requestOk(
    memberAPage,
    `${API_PATHS.notifications}?limit=100`,
    'member A DM notifications',
    notificationsListOutputSchema,
  );
  const unreadDmNotifications = memberANotifications.notifications.filter(
    (notification) =>
      notification.kind === 'dm-message'
      && notification.payload.contextId === conversationId
      && notification.readAt === null,
  );
  assert(
    unreadDmNotifications.length === 1,
    `Expected one collapsed unread DM notification, got ${String(unreadDmNotifications.length)}`,
  );
  const memberAUnreadMessages = await requestOk(
    memberAPage,
    API_PATHS.messagesUnread,
    'member A unread messages before deep link',
    messagesUnreadOutputSchema,
  );
  assert(memberAUnreadMessages.unread === 1, `Member A unread message count was ${String(memberAUnreadMessages.unread)}`);
  const memberAUnreadNotifications = await requestOk(
    memberAPage,
    API_PATHS.notificationsUnread,
    'member A unread notifications before deep link',
    notificationsUnreadOutputSchema,
  );
  assert(
    memberAUnreadNotifications.unread === 1,
    `Member A unread notification count was ${String(memberAUnreadNotifications.unread)}`,
  );

  const notification = unreadDmNotifications[0];
  assert(notification !== undefined, 'Collapsed DM notification was unavailable');
  await memberAPage.goto(`${baseUrl}/notifications`, { waitUntil: 'domcontentloaded' });
  await memberAPage.getByTestId(`notification-open-${notification.id}`).click();
  await memberAPage.waitForURL(`**/messages/${conversationId}`, { timeout: 15000 });
  await memberAPage.getByText(replies[2] ?? '', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });

  await pollUntil(async () => {
    const [messageUnread, notificationUnread, notifications] = await Promise.all([
      requestOk(
        memberAPage,
        API_PATHS.messagesUnread,
        'member A unread messages after deep link',
        messagesUnreadOutputSchema,
      ),
      requestOk(
        memberAPage,
        API_PATHS.notificationsUnread,
        'member A unread notifications after deep link',
        notificationsUnreadOutputSchema,
      ),
      requestOk(
        memberAPage,
        `${API_PATHS.notifications}?limit=100`,
        'member A notifications after deep link',
        notificationsListOutputSchema,
      ),
    ]);
    assert(messageUnread.unread === 0, 'DM deep link did not zero the unread conversation count');
    assert(notificationUnread.unread === 0, 'DM deep link did not zero the unread notification count');
    const opened = notifications.notifications.find(({ id }) => id === notification.id);
    assert(opened?.readAt !== null && opened?.readAt !== undefined, 'DM notification remained unread');
  }, 'DM deep-link read state');
  console.log('member-activity-e2e: DM unread state, SSE refresh, collapse, and deep link OK');
  return conversationId;
};

const pollForOpenDmReports = async (
  creatorPage: Page,
  conversationId: string,
): Promise<output<typeof dmReportsListOutputSchema>['reports']> => {
  let found: output<typeof dmReportsListOutputSchema>['reports'] = [];
  await pollUntil(async () => {
    const queue = await requestOk(
      creatorPage,
      `${API_PATHS.dmReports}?status=open`,
      'open DM reports',
      dmReportsListOutputSchema,
    );
    found = queue.reports.filter((report) => report.conversationId === conversationId);
    assert(found.length === 1, `Expected one open DM report, got ${String(found.length)}`);
  }, 'DM report arrival');
  return found;
};

const openConversationMenuItem = async (page: Page, testId: string): Promise<void> => {
  await page.getByTestId('conversation-menu').click();
  const item = page.getByTestId(testId);
  await item.waitFor({ state: 'visible', timeout: 15000 });
  await item.click();
};

const runBlockAndReportJourney = async (
  memberAPage: Page,
  memberBPage: Page,
  creatorPage: Page,
  baseUrl: string,
  conversationId: string,
): Promise<void> => {
  const conversationUrl = `${baseUrl}/messages/${conversationId}`;
  await memberBPage.goto(conversationUrl, { waitUntil: 'domcontentloaded' });
  await memberBPage.getByTestId('conversation-page').waitFor({ state: 'visible', timeout: 15000 });
  await openConversationMenuItem(memberBPage, 'conversation-block');
  await memberBPage.getByTestId('conversation-send-blocked').waitFor({ state: 'visible', timeout: 15000 });

  await memberAPage.goto(conversationUrl, { waitUntil: 'domcontentloaded' });
  await memberAPage.getByTestId('conversation-send-blocked').waitFor({ state: 'visible', timeout: 15000 });
  assert(
    await memberAPage.getByTestId('message-composer-input').count() === 0,
    'A blocked sender still saw the composer',
  );
  const rejected = await browserRequest(memberAPage, API_PATHS.messagesSend, {
    method: 'POST',
    body: JSON.stringify({ conversationId, body: 'E2E blocked message' }),
  });
  assert(rejected.status === 403, `Blocked send returned HTTP ${String(rejected.status)}`);

  await openConversationMenuItem(memberAPage, 'conversation-report');
  await memberAPage.getByTestId('dm-report-submit').click();

  const openReports = await pollForOpenDmReports(creatorPage, conversationId);
  const report = openReports[0];
  assert(report !== undefined, 'Staff did not receive the reported conversation');
  assert(
    report.snapshot.some((message) => message.body === firstMessage),
    'The report snapshot did not carry the conversation tail',
  );
  assert(
    report.snapshot.length <= DM_REPORT_SNAPSHOT_SIZE,
    `The report snapshot held ${String(report.snapshot.length)} messages`,
  );

  await creatorPage.goto(`${baseUrl}/panel/reports`, { waitUntil: 'domcontentloaded' });
  await creatorPage.getByTestId(`dm-report-resolve-${report.id}`).click();
  await creatorPage.getByTestId('confirm-dialog-confirm').click();
  await pollUntil(async () => {
    const remaining = await requestOk(
      creatorPage,
      `${API_PATHS.dmReports}?status=open`,
      'open DM reports after resolve',
      dmReportsListOutputSchema,
    );
    assert(remaining.openCount === 0, 'Resolving the DM report left it open');
  }, 'DM report resolution');

  await memberBPage.reload({ waitUntil: 'domcontentloaded' });
  await openConversationMenuItem(memberBPage, 'conversation-unblock');
  await memberBPage.getByTestId('message-composer-input').waitFor({ state: 'visible', timeout: 15000 });

  await memberAPage.reload({ waitUntil: 'domcontentloaded' });
  await memberAPage.getByTestId('message-composer-input').waitFor({ state: 'visible', timeout: 15000 });
  await sendMessage(memberAPage, 'E2E message after unblock');
  console.log('member-activity-e2e: DM block, neutral send state, report snapshot, and resolve OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
try {
  console.log('member-activity-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateSeedAndActivateMembers(e2eDatabaseUrl);
  console.log('member-activity-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`member-activity-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: studioBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });

  browser = await chromium.launch(
    chromeExecutablePath
      ? { executablePath: chromeExecutablePath, headless: true }
      : { channel: 'chrome', headless: true },
  );
  const creatorContext = await browser.newContext();
  const memberAContext = await browser.newContext();
  const memberBContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  await Promise.all([
    setEnglish(creatorContext),
    setEnglish(memberAContext),
    setEnglish(memberBContext),
    setEnglish(anonymousContext),
  ]);
  const creatorPage = await creatorContext.newPage();
  const memberAPage = await memberAContext.newPage();
  const memberBPage = await memberBContext.newPage();
  const anonymousPage = await anonymousContext.newPage();
  for (const page of [creatorPage, memberAPage, memberBPage, anonymousPage]) {
    page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));
  }

  await signInCreator(creatorPage, studioBaseUrl);
  await signInMember(memberAPage, studioBaseUrl, 'kursant.aktywny@together.dev');
  await signInMember(memberBPage, studioBaseUrl, 'free@together.dev');
  await requestOk(
    memberAPage,
    API_PATHS.notificationsReadAll,
    'clear member A notification baseline',
    notificationsReadAllOutputSchema,
    { method: 'POST' },
  );
  const created = await createLiveEvent(creatorPage);
  await runEventJourney(memberAPage, anonymousPage, studioBaseUrl, created);
  const conversationId = await runDirectMessageJourney(memberAPage, memberBPage, studioBaseUrl);
  await runBlockAndReportJourney(
    memberAPage,
    memberBPage,
    creatorPage,
    studioBaseUrl,
    conversationId,
  );
  await Promise.all([
    creatorContext.close(),
    memberAContext.close(),
    memberBContext.close(),
    anonymousContext.close(),
  ]);
  console.log(`\nmember-activity-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\nmember-activity-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
