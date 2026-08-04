import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { z } from 'zod';

import { API_PATHS } from '#core/contract/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const webDistDir = join(rootDir, 'dist/web');
const qaDir = join(homedir(), 'private-archive/spaces/qa');

const results: string[] = [];
const record = (label: string, pass: boolean, detail = ''): void => {
  results.push(`${pass ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) process.exitCode = 1;
};
const must = (label: string, pass: boolean, detail = ''): void => {
  record(label, pass, detail);
  if (!pass) throw new Error(`QA assertion failed: ${label} ${detail}`);
};

const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('no port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const bootServer = async (port: number): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: devDatabaseUrl,
      APP_BASE_URL: `http://localhost:${port}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
    },
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}${API_PATHS.health}`);
      if (response.ok) return child;
    } catch {
      // booting
    }
    await delay(250);
  }
  throw new Error('server did not become ready');
};

interface CliSession {
  home: string;
  token: () => string;
}

const cliConfigSchema = z.object({
  profiles: z.record(
    z.string(),
    z.object({ token: z.string().nullable() }),
  ),
});

const cliSession = (): CliSession => {
  const home = mkdtempSync(join(tmpdir(), 'qa-spaces-'));
  return {
    home,
    token: () => {
      const config = cliConfigSchema.parse(
        JSON.parse(readFileSync(join(home, '.config/together/config.json'), 'utf8')),
      );
      const token = Object.values(config.profiles).find((profile) => profile.token !== null)?.token;
      if (token !== undefined && token !== null) return token;
      throw new Error('no CLI token');
    },
  };
};

const cli = (session: CliSession, apiUrl: string, args: string[]): string =>
  execFileSync(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', apiUrl, ...args], {
    cwd: rootDir,
    env: { ...process.env, HOME: session.home },
    encoding: 'utf8',
  });

const envelopeData = (raw: string): unknown => {
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null && 'data' in parsed ? parsed.data : null;
};

const curl = (args: string[]): string =>
  execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', ...args], { encoding: 'utf8' });

const curlBody = (args: string[]): string => execFileSync('curl', ['-s', ...args], { encoding: 'utf8' });

const shoot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: join(qaDir, `${name}.png`), fullPage: false });
};

const signInMember = async (page: Page, baseUrl: string, email: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').fill(email);
  await page.getByRole('button', { name: 'Wyślij mi magiczny link' }).click();
  const magicLink = page.getByRole('link', { name: 'Otwórz magiczny link' });
  await magicLink.waitFor({ state: 'visible', timeout: 15000 });
  const href = await magicLink.getAttribute('href');
  if (href === null) throw new Error('no magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

const signInCreator = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo-password-15');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 15000 });
};

mkdirSync(qaDir, { recursive: true });
const port = await ephemeralPort();
const server = await bootServer(port);
const apiUrl = `http://localhost:${port}`;
const studioUrl = `http://studio.localhost:${port}`;
let browser: Browser | null = null;
const probeTenantSlug = `qa-spaces-${Date.now().toString(36)}`;

try {
  const probeStaff = cliSession();
  cli(probeStaff, apiUrl, ['login', '--email', 'creator3@together.dev', '--password', 'demo-password-15']);
  cli(probeStaff, apiUrl, ['tenant', 'create', 'QA Spaces Probe', '--slug', probeTenantSlug]);
  const slug = `probe-${Date.now().toString(36)}`;
  const created = envelopeData(
    cli(probeStaff, apiUrl, [
      '--tenant', probeTenantSlug, 'space', 'create',
      '--slug', slug, '--name', 'Strefa QA', '--visibility', 'members',
    ]),
  );
  const probeSpaceId =
    typeof created === 'object' && created !== null && 'space' in created &&
    typeof created.space === 'object' && created.space !== null && 'id' in created.space &&
    typeof created.space.id === 'string'
      ? created.space.id
      : null;
  must('throwaway tenant owner creates a probe space via CLI', probeSpaceId !== null);
  if (probeSpaceId === null) throw new Error('unreachable');

  const studioMember = cliSession();
  cli(studioMember, apiUrl, ['login-magic', '--email', 'kursant.aktywny@together.dev']);
  const memberToken = studioMember.token();

  const feedPath = API_PATHS.spaceFeed.replace(':spaceId', probeSpaceId);
  const probeLog: string[] = [];

  const crossTenant = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', `x-tenant: ${probeTenantSlug}`,
    `${apiUrl}${feedPath}`,
  ]);
  probeLog.push(`studio member token + x-tenant: ${probeTenantSlug} -> HTTP ${crossTenant}`);
  record(
    'cross-tenant probe: studio member cannot read the throwaway tenant space feed',
    crossTenant === '401' || crossTenant === '403' || crossTenant === '404',
    `HTTP ${crossTenant}`,
  );

  const wrongTenantId = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'x-tenant: studio',
    `${apiUrl}${feedPath}`,
  ]);
  probeLog.push(`studio member on studio tenant, throwaway space id -> HTTP ${wrongTenantId}`);
  record(
    'cross-tenant probe: throwaway space id yields 404 inside the studio tenant',
    wrongTenantId === '404',
    `HTTP ${wrongTenantId}`,
  );

  const anonymous = curl(['-H', `x-tenant: ${probeTenantSlug}`, `${apiUrl}${feedPath}`]);
  probeLog.push(`anonymous -> HTTP ${anonymous}`);
  record('cross-tenant probe: anonymous request is rejected', anonymous === '401', `HTTP ${anonymous}`);

  const legit = curlBody([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'x-tenant: studio',
    `${apiUrl}${API_PATHS.spaceFeed.replace(':spaceId', 'space-studio-spolecznosc')}`,
  ]);
  probeLog.push(`studio member reads own tenant feed -> ${legit.slice(0, 120)}...`);
  record(
    'control probe: the same token DOES read the studio feed',
    legit.includes('"spaceId":"space-studio-spolecznosc"'),
  );
  writeFileSync(join(qaDir, 'cross-tenant-probe.txt'), `${probeLog.join('\n')}\n`);

  browser = await chromium.launch();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberPage = await desktop.newPage();
  await signInMember(memberPage, studioUrl, 'kursant.aktywny@together.dev');
  await memberPage.goto(`${studioUrl}/community`, { waitUntil: 'load' });
  await memberPage.getByTestId('space-card-space-studio-spolecznosc').waitFor({ state: 'visible' });
  record(
    'member desktop: community tab lists the gated space for the entitled member',
    await memberPage.getByTestId('space-card-space-studio-klub-js').isVisible(),
  );
  await shoot(memberPage, 'member-community-desktop');

  await memberPage.goto(`${studioUrl}/community/space-studio-spolecznosc`, { waitUntil: 'load' });
  const reaction = memberPage.getByTestId('reaction-post-spolecznosc-hello-👍');
  await reaction.waitFor({ state: 'visible' });
  const before = (await reaction.innerText()).trim();
  await reaction.click();
  await memberPage.waitForFunction(
    ({ selector, previous }) => {
      const el = document.querySelector(selector);
      return el !== null && el.textContent !== null && el.textContent.trim() !== previous;
    },
    { selector: '[data-testid="reaction-post-spolecznosc-hello-👍"]', previous: before },
    { timeout: 10000 },
  );
  const after = (await reaction.innerText()).trim();
  record('member desktop: reaction toggles live without reload', before !== after, `${before} -> ${after}`);
  await shoot(memberPage, 'member-space-feed-reacted-desktop');
  await reaction.click();
  await memberPage.waitForFunction(
    ({ selector, previous }) => {
      const el = document.querySelector(selector);
      return el !== null && el.textContent !== null && el.textContent.trim() === previous;
    },
    { selector: '[data-testid="reaction-post-spolecznosc-hello-👍"]', previous: before },
    { timeout: 10000 },
  );
  record('member desktop: second click restores the original reaction count', true, `back to ${before}`);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await signInMember(mobilePage, studioUrl, 'kursant.aktywny@together.dev');
  await mobilePage.goto(`${studioUrl}/community`, { waitUntil: 'load' });
  await mobilePage.getByTestId('space-card-space-studio-spolecznosc').waitFor({ state: 'visible' });
  const communityTab = mobilePage.getByRole('link', { name: 'Społeczność' }).last();
  record('member mobile: bottom tab bar shows the community tab', await communityTab.isVisible());
  await shoot(mobilePage, 'member-community-mobile');
  await mobilePage.goto(`${studioUrl}/community/space-studio-spolecznosc`, { waitUntil: 'load' });
  await mobilePage.getByTestId('post-body-post-spolecznosc-hello').waitFor({ state: 'visible' });
  await shoot(mobilePage, 'member-space-feed-mobile');
  await mobile.close();

  const gated = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const gatedPage = await gated.newPage();
  await signInMember(gatedPage, studioUrl, 'kursant.modul@together.dev');
  await gatedPage.goto(`${studioUrl}/community`, { waitUntil: 'load' });
  await gatedPage.getByTestId('space-card-space-studio-spolecznosc').waitFor({ state: 'visible' });
  record(
    'gated visibility: module-only member does NOT see the product-gated space',
    !(await gatedPage.getByTestId('space-card-space-studio-klub-js').isVisible()),
  );
  await shoot(gatedPage, 'member-moduleonly-community-desktop');
  const gatedResponse = await gatedPage.goto(`${studioUrl}/community/space-studio-klub-js`, {
    waitUntil: 'load',
  });
  await delay(2500);
  const gatedBody = await gatedPage.locator('body').innerText();
  record(
    'gated visibility: direct navigation to the gated space shows an error, not the feed',
    !gatedBody.includes('Wyzwanie tygodnia') &&
      (await gatedPage.getByTestId('post-body-post-klub-wyzwanie').count()) === 0,
    `status ${String(gatedResponse?.status())}`,
  );
  await shoot(gatedPage, 'member-moduleonly-gated-space-desktop');
  await gated.close();

  const panel = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const panelPage = await panel.newPage();
  await signInCreator(panelPage, studioUrl);
  await panelPage.goto(`${studioUrl}/panel/spaces`, { waitUntil: 'load' });
  await panelPage.getByTestId('space-manage-space-studio-spolecznosc').waitFor({ state: 'visible' });
  await shoot(panelPage, 'panel-spaces-list-desktop');

  await panelPage.goto(`${studioUrl}/panel/spaces/new`, { waitUntil: 'load' });
  await panelPage.getByLabel('nazwa').fill('Strefa QA');
  await panelPage.getByLabel('opis').fill('Utworzona przez adwersaryjne QA przeglądarki.');
  await panelPage.getByTestId('space-form-submit').click();
  await panelPage.waitForURL('**/panel/spaces', { timeout: 15000 });
  const createdRow = panelPage.getByRole('heading', { name: 'Strefa QA' });
  await createdRow.waitFor({ state: 'visible' });
  record('panel CRUD: create via form lands back on the list with the new space', true);
  await shoot(panelPage, 'panel-spaces-created-desktop');

  const qaSpaceHref = await panelPage
    .locator('[data-testid^="space-manage-"]')
    .evaluateAll((links, needle) => {
      for (const link of links) {
        const row = link.closest('[data-testid="space-row"]');
        if (row !== null && row.textContent !== null && row.textContent.includes(needle)) {
          return link.getAttribute('href');
        }
      }
      return null;
    }, 'Strefa QA');
  must('panel CRUD: the created space has a manage link', qaSpaceHref !== null);
  if (qaSpaceHref === null) throw new Error('unreachable');
  const qaSpaceId = decodeURIComponent(qaSpaceHref.split('/').at(-1) ?? '');

  await panelPage.goto(`${studioUrl}${qaSpaceHref}`, { waitUntil: 'load' });
  await panelPage.getByLabel('nazwa').fill('Strefa QA (po edycji)');
  await panelPage.getByTestId('space-form-submit').click();
  await panelPage.waitForURL('**/panel/spaces', { timeout: 15000 });
  await panelPage.getByRole('heading', { name: 'Strefa QA (po edycji)' }).waitFor({ state: 'visible' });
  record('panel CRUD: edit renames the space', true);

  await panelPage.getByTestId(`space-archive-${qaSpaceId}`).click();
  await panelPage.getByTestId(`space-archive-confirm-${qaSpaceId}`).click();
  await panelPage
    .getByTestId(`space-archive-${qaSpaceId}`)
    .waitFor({ state: 'detached', timeout: 15000 });
  record('panel CRUD: archiving removes the space from the default active filter', true);
  await panelPage.getByRole('group', { name: 'Filtr stref' }).getByText('Zarchiwizowane').click();
  await panelPage.getByTestId(`space-restore-${qaSpaceId}`).waitFor({ state: 'visible', timeout: 15000 });
  record('panel CRUD: the archived filter shows the row with a restore action', true);
  await shoot(panelPage, 'panel-spaces-archived-desktop');
  await panelPage.getByTestId(`space-restore-${qaSpaceId}`).click();
  await panelPage
    .getByTestId(`space-restore-${qaSpaceId}`)
    .waitFor({ state: 'detached', timeout: 15000 });
  await panelPage.getByRole('group', { name: 'Filtr stref' }).getByText('Aktywne').click();
  await panelPage.getByTestId(`space-archive-${qaSpaceId}`).waitFor({ state: 'visible', timeout: 15000 });
  record('panel CRUD: restore brings the space back to active', true);

  const panelMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const panelMobilePage = await panelMobile.newPage();
  await signInCreator(panelMobilePage, studioUrl);
  await panelMobilePage.goto(`${studioUrl}/panel/spaces`, { waitUntil: 'load' });
  await panelMobilePage.getByTestId('space-manage-space-studio-spolecznosc').waitFor({ state: 'visible' });
  await shoot(panelMobilePage, 'panel-spaces-list-mobile');
  await panelMobile.close();

  const studioStaff = cliSession();
  cli(studioStaff, apiUrl, ['login', '--email', 'creator@together.dev', '--password', 'demo-password-15']);
  const staffToken = studioStaff.token();
  const pinArgs = [
    '-X', 'POST',
    '-H', 'content-type: application/json',
    '-H', 'x-tenant: studio',
    '-d', JSON.stringify({ postId: 'post-spolecznosc-hello', pinned: true }),
    `${apiUrl}${API_PATHS.postsPin}`,
  ];
  const memberPin = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    ...pinArgs,
  ]);
  record('pin authorization: members cannot pin a space post', memberPin === '403', `HTTP ${memberPin}`);
  const staffPin = curl([
    '-H', `authorization: Bearer ${staffToken}`,
    ...pinArgs,
  ]);
  must('pin lifecycle: staff can pin a space post', staffPin === '200', `HTTP ${staffPin}`);
  const feedSchema = z.object({
    ok: z.literal(true),
    data: z.object({ feed: z.object({ pinned: z.array(z.object({ id: z.string() })) }) }),
  });
  const pinnedFeed = feedSchema.parse(JSON.parse(curlBody([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'x-tenant: studio',
    `${apiUrl}${API_PATHS.spaceFeed.replace(':spaceId', 'space-studio-spolecznosc')}`,
  ])));
  must(
    'pin lifecycle: the pinned post appears in the member feed projection',
    pinnedFeed.data.feed.pinned.some((post) => post.id === 'post-spolecznosc-hello'),
  );
  const staffUnpin = curl([
    '-H', `authorization: Bearer ${staffToken}`,
    '-X', 'POST',
    '-H', 'content-type: application/json',
    '-H', 'x-tenant: studio',
    '-d', JSON.stringify({ postId: 'post-spolecznosc-hello', pinned: false }),
    `${apiUrl}${API_PATHS.postsPin}`,
  ]);
  must('pin lifecycle: staff can unpin a space post', staffUnpin === '200', `HTTP ${staffUnpin}`);
  const unpinnedFeed = feedSchema.parse(JSON.parse(curlBody([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'x-tenant: studio',
    `${apiUrl}${API_PATHS.spaceFeed.replace(':spaceId', 'space-studio-spolecznosc')}`,
  ])));
  must(
    'pin lifecycle: the unpinned post leaves the pinned projection',
    unpinnedFeed.data.feed.pinned.every((post) => post.id !== 'post-spolecznosc-hello'),
  );

  const moderationPost = z.object({
    post: z.object({ id: z.string() }),
  }).parse(envelopeData(cli(studioStaff, apiUrl, [
    '--tenant', 'studio', 'space', 'post',
    '--space', 'space-studio-spolecznosc',
    '--body', 'QA moderation lifecycle target',
  ])));
  const reported = z.object({
    report: z.object({ id: z.string(), postId: z.string(), status: z.literal('open') }),
  }).parse(envelopeData(cli(studioMember, apiUrl, [
    '--tenant', 'studio', 'post', 'report',
    '--post', moderationPost.post.id,
    '--reason', 'spam',
    '--note', 'QA moderation lifecycle probe',
  ])));
  const listedReports = z.object({
    items: z.array(z.object({ report: z.object({ id: z.string() }) })),
  }).parse(envelopeData(cli(studioStaff, apiUrl, ['--tenant', 'studio', 'report', 'list'])));
  must(
    'report lifecycle: staff queue contains the member report',
    listedReports.items.some((item) => item.report.id === reported.report.id),
  );
  const duplicateReport = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'content-type: application/json',
    '-H', 'x-tenant: studio',
    '-d', JSON.stringify({ postId: moderationPost.post.id, reason: 'spam' }),
    `${apiUrl}${API_PATHS.postsReport}`,
  ]);
  must('report lifecycle: a duplicate member report returns conflict', duplicateReport === '409', `HTTP ${duplicateReport}`);

  await panelPage.goto(`${studioUrl}/panel/reports`, { waitUntil: 'load' });
  await panelPage.getByTestId('report-row').first().waitFor({ state: 'visible', timeout: 15000 });
  await shoot(panelPage, 'panel-reports-open-desktop');

  cli(studioStaff, apiUrl, [
    '--tenant', 'studio', 'report', 'resolve',
    '--report', reported.report.id,
    '--action', 'delete-post',
  ]);
  const deletedFeed = z.object({
    ok: z.literal(true),
    data: z.object({
      feed: z.object({
        items: z.array(z.object({ id: z.string(), deletedAt: z.string().nullable() })),
      }),
    }),
  }).parse(JSON.parse(curlBody([
    '-H', `authorization: Bearer ${memberToken}`,
    '-H', 'x-tenant: studio',
    `${apiUrl}${API_PATHS.spaceFeed.replace(':spaceId', 'space-studio-spolecznosc')}`,
  ])));
  must(
    'report lifecycle: deleting through moderation leaves only the removal projection',
    deletedFeed.data.feed.items.some((post) => post.id === moderationPost.post.id && post.deletedAt !== null),
  );

  cli(studioStaff, apiUrl, [
    '--tenant', 'studio', 'member', 'ban',
    '--member', 'member-studio-aktywny',
    '--reason', 'QA moderation lifecycle probe',
  ]);
  await panelPage.goto(`${studioUrl}/panel/members/member-studio-aktywny`, { waitUntil: 'load' });
  await panelPage.getByText('QA moderation lifecycle probe').waitFor({ state: 'visible', timeout: 15000 });
  await shoot(panelPage, 'panel-member-banned-desktop');

  const bannedPostArgs = [
    '-X', 'POST',
    '-H', 'content-type: application/json',
    '-H', 'x-tenant: studio',
    '-d', JSON.stringify({
      contextKind: 'space',
      contextId: 'space-studio-spolecznosc',
      body: 'QA post after moderation transition',
    }),
    `${apiUrl}${API_PATHS.postsCreate}`,
  ];
  const bannedPostStatus = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    ...bannedPostArgs,
  ]);
  const bannedPostBody = z.object({
    ok: z.literal(false),
    error: z.object({ code: z.literal('banned') }),
  }).parse(JSON.parse(curlBody([
    '-H', `authorization: Bearer ${memberToken}`,
    ...bannedPostArgs,
  ])));
  must(
    'ban lifecycle: a banned member receives the distinct banned error',
    bannedPostStatus === '403' && bannedPostBody.error.code === 'banned',
    `HTTP ${bannedPostStatus}`,
  );
  cli(studioStaff, apiUrl, [
    '--tenant', 'studio', 'member', 'unban',
    '--member', 'member-studio-aktywny',
  ]);
  const restoredPost = curl([
    '-H', `authorization: Bearer ${memberToken}`,
    ...bannedPostArgs,
  ]);
  must('ban lifecycle: lifting the ban restores posting', restoredPost === '200', `HTTP ${restoredPost}`);

  cli(studioStaff, apiUrl, ['--tenant', 'studio', 'space', 'delete', '--space', qaSpaceId]);
  const deleteProbe = cli(studioStaff, apiUrl, ['--tenant', 'studio', 'space', 'stats']);
  record('panel CRUD: delete removes the space (staff stats no longer list it)', !deleteProbe.includes(qaSpaceId));
  await panel.close();
} finally {
  if (browser !== null) await browser.close();
  const cleanupPool = new pg.Pool({ connectionString: devDatabaseUrl });
  try {
    await cleanupPool.query('delete from tenants where slug = $1', [probeTenantSlug]);
  } finally {
    await cleanupPool.end();
  }
  const { pid } = server;
  try {
    if (pid !== undefined) process.kill(-pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  const summary = results.join('\n');
  writeFileSync(join(qaDir, 'qa-results.txt'), `${summary}\n`);
  console.log(summary);
}
