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
  const usePassword = page.getByTestId('use-password');
  const passwordField = page.getByTestId('login-password');
  await passwordField.or(usePassword).first().waitFor(visible);
  if (await usePassword.isVisible()) await usePassword.click();
  await passwordField.waitFor(visible);
  await passwordField.fill(password);
  await page.getByTestId('signin-submit').click();
};

export const requestMagicLink = async (page: Page, email: string): Promise<void> => {
  await continueWithIdentifier(page, email);
  const useMagicLink = page.getByTestId('use-magic-link');
  const send = page.getByTestId('send-magic-link');
  await send.or(useMagicLink).first().waitFor(visible);
  if (await useMagicLink.isVisible()) await useMagicLink.click();
  await send.waitFor(visible);
  await send.click();
};
