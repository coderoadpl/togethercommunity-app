import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { en } from '../../i18n/en.js';
import { LanguageProvider, useTranslations } from '../../i18n/index.js';
import { pl } from '../../i18n/pl.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

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
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent(pl.checkout.submitIdle);

    await user.click(screen.getByRole('button', { name: 'en' }));

    expect(screen.getByTestId('checkout-cta')).toHaveTextContent(en.checkout.submitIdle);
  });

  it('restores the persisted language on a fresh mount', async () => {
    const user = userEvent.setup();
    const first = renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'en' }));
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent(en.checkout.submitIdle);
    first.unmount();

    renderSwitcher();
    expect(screen.getByTestId('checkout-cta')).toHaveTextContent(en.checkout.submitIdle);
  });
});
