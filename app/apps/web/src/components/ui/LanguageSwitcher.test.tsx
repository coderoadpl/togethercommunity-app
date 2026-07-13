import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { LanguageProvider, useTranslations } from '../../i18n/index.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

/**
 * Node >= 25 exposes a non-functional global localStorage that shadows jsdom's
 * working one in vitest, so the persistence assertions need a real in-memory
 * stand-in (mirrors ThemeSwitcher.test).
 */
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});
afterAll(() => vi.unstubAllGlobals());

const Probe = () => {
  const t = useTranslations();
  return <p data-testid="checkout-cta">{t.checkout.submitIdle}</p>;
};

const renderSwitcher = () =>
  render(
    <LanguageProvider>
      <LanguageSwitcher />
      <Probe />
    </LanguageProvider>,
  );

describe('LanguageSwitcher', () => {
  it('swaps the Polish default text to English when English is picked', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent('Symuluj płatność (dev)');

    await user.click(screen.getByRole('button', { name: 'en' }));

    expect(screen.getByTestId('checkout-cta')).toHaveTextContent('Simulate payment (dev)');
  });

  it('restores the persisted language on a fresh mount', async () => {
    const user = userEvent.setup();
    const first = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'en' }));
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent('Simulate payment (dev)');
    first.unmount();

    renderSwitcher();
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent('Simulate payment (dev)');
  });
});
