import type { Page } from 'playwright-core';

const visible = { state: 'visible' as const, timeout: 20000 };

export const continueWithIdentifier = async (page: Page, email: string): Promise<void> => {
  const identifier = page.getByTestId('login-email');
  await identifier.waitFor(visible);
  await identifier.fill(email);
  await page.getByTestId('login-continue').click();
};

export const signInWithPassword = async (
  page: Page,
  email: string,
  password: string,
): Promise<void> => {
  await continueWithIdentifier(page, email);
  const passwordField = page.getByTestId('login-password');
  await passwordField.waitFor(visible);
  await passwordField.fill(password);
  await page.getByTestId('signin-submit').click();
};

export const requestMagicLink = async (page: Page, email: string): Promise<void> => {
  await continueWithIdentifier(page, email);
  const send = page.getByTestId('send-magic-link');
  await send.waitFor(visible);
  await send.click();
};
