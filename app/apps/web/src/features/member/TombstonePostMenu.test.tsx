import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { LanguageProvider } from '../../i18n/index.js';
import { en } from '../../i18n/en.js';
import { pl } from '../../i18n/pl.js';
import { languagePreference } from '../../theme-mode.js';
import { renderWithProviders } from '../../test/render.js';
import { TombstonePostMenu } from './TombstonePostMenu.js';

afterEach(() => vi.restoreAllMocks());

it.each(['en', 'pl'] as const)('shows the irreversible cascade warning in %s', async (language) => {
  vi.spyOn(languagePreference, 'loadStored').mockReturnValue(language);
  const t = language === 'en' ? en : pl;
  renderWithProviders(<LanguageProvider><TombstonePostMenu postId="post" writeDisabled={false} /></LanguageProvider>);
  await userEvent.click(screen.getByTestId('post-menu-post'));
  expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  await userEvent.click(screen.getByRole('menuitem', { name: t.discussion.purge }));
  expect(await screen.findByText(t.discussion.purgeConfirmBody)).toBeInTheDocument();
  expect(screen.getByTestId('confirm-purge-post')).toHaveTextContent(t.discussion.purge);
});

it('disables purge when writes are disabled', async () => {
  renderWithProviders(<TombstonePostMenu postId="post" writeDisabled />);
  await userEvent.click(screen.getByTestId('post-menu-post'));
  expect(screen.getByTestId('purge-button-post')).toHaveAttribute('aria-disabled', 'true');
});
