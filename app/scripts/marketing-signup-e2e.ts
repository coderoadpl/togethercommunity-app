import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

import { createApiClient } from '#core/client/index.js';
import { en } from '../apps/web/src/i18n/en.js';
import { rootDir } from './server-harness.js';

export const verifyMarketingSignupBrowser = async (baseUrl: string, staffToken: string, consentDefinitionId: string): Promise<void> => {
  const api = createApiClient({ baseUrl, headers: () => ({ authorization: `Bearer ${staffToken}` }) });
  const created = await api.createMarketingSignupForm({ slug: 'public-newsletter', name: 'Newsletter', consentDefinitionId, listId: null, tags: ['hosted-signup'], collectName: true, successText: { en: 'Thank you for joining.', pl: 'Thank you for joining.' }, redirectUrl: null, allowedOrigins: [] });
  if (!created.ok) throw new Error(`Signup form creation failed: ${created.error.code}`);
  const executablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: 'chrome', headless: true });
  const artifacts = join(rootDir, '.lead-artifacts');
  await mkdir(artifacts, { recursive: true });
  try {
    const context = await browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${staffToken}` }, locale: 'en-US' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/marketing/forms/public-newsletter?lang=en`);
        await page.getByRole('button', { name: 'Sign up', exact: true }).waitFor();
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Hosted signup page overflows its viewport');
        await page.screenshot({ path: join(artifacts, `hosted-${colorScheme}-${width}.png`), fullPage: true });
      }
    }
    await page.getByLabel('Email address', { exact: true }).fill('hosted-reader@example.org');
    await page.getByLabel('Name (optional)', { exact: true }).fill('Hosted reader');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.waitForURL('**/marketing/forms/public-newsletter/thanks?lang=en');
    await page.getByText('Check your inbox and confirm your email address to complete your signup.').waitFor();
    await page.screenshot({ path: join(artifacts, 'hosted-pending-390.png'), fullPage: true });
    const contacts = await api.listMarketingContacts({ search: 'hosted-reader@example.org', consentDefinitionId, consentState: 'pending_confirmation' });
    if (!contacts.ok || contacts.value.contacts.length !== 1) throw new Error('Hosted signup did not create a contact with pending consent');
    const contact = contacts.value.contacts[0];
    if (contact === undefined) throw new Error('Signup contact is missing');
    await page.addInitScript(() => { localStorage.setItem('together-language', 'en'); });
    await page.goto(`${baseUrl}/panel/marketing/contacts/${contact.id}`);
    await page.getByRole('combobox', { name: en.directory.consentDefinition }).click();
    await page.getByRole('option', { name: 'newsletter', exact: true }).click();
    await page.getByText(`${en.directory.consentState}: ${en.directory.pending_confirmation}`, { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, 'studio-contact-consent-390.png'), fullPage: true });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/panel/marketing/forms`);
        await page.getByRole('button', { name: en.signupForms.embed, exact: true }).waitFor();
        await page.screenshot({ path: join(artifacts, `studio-forms-${colorScheme}-${width}.png`), fullPage: true });
      }
    }
    if (errors.length > 0) throw new Error(`Signup browser errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
  }
};
