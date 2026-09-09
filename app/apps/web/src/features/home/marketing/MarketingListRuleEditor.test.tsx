import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { MarketingListRule } from '#core/domain/index.js';
import { pl } from '../../../i18n/pl.js';
import { renderWithProviders } from '../../../test/render.js';
import { server } from '../../../test/server.js';
import { MarketingListRuleEditor } from './MarketingListRuleEditor.js';

const Editor = () => {
  const [rule, setRule] = useState<MarketingListRule>({ kind: 'tag', tags: ['launch'], match: 'any' });
  return <MarketingListRuleEditor rule={rule} onChange={setRule} />;
};
describe('dynamic list rule editor', () => {
  it('assigns distinct product selector labels to multiple editors', async () => {
    server.use(http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })));
    const rule: MarketingListRule = { kind: 'product_grant', productIds: [], state: 'active' };
    renderWithProviders(<><MarketingListRuleEditor rule={rule} onChange={() => undefined} /><MarketingListRuleEditor rule={rule} onChange={() => undefined} /></>);
    const selectors = await screen.findAllByRole('combobox', { name: pl.directory.products });
    expect(selectors).toHaveLength(2);
    expect(new Set(selectors.map((select) => select.getAttribute('aria-labelledby'))).size).toBe(2);
  });
  it('switches between tags, product grant windows and active consent', async () => {
    server.use(http.get('/api/products', () => HttpResponse.json({ ok: true, data: { products: [] } })), http.get('/api/marketing/consent-definitions', () => HttpResponse.json({ ok: true, data: { definitions: [] } })));
    renderWithProviders(<Editor />);
    await userEvent.type(screen.getByLabelText(pl.directory.tags), '|news');
    expect(screen.getByLabelText(pl.directory.tags)).toHaveValue('launch|news');
    await userEvent.click(screen.getByRole('combobox', { name: pl.directory.match }));
    await userEvent.click(screen.getByRole('option', { name: pl.directory.allTags }));
    expect(screen.getByRole('combobox', { name: pl.directory.match })).toHaveTextContent(pl.directory.allTags);
    await userEvent.click(screen.getByRole('combobox', { name: pl.directory.rule }));
    await userEvent.click(screen.getByRole('option', { name: pl.directory.productRule }));
    expect(screen.getByText(pl.directory.grantHint)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: pl.directory.grantState }));
    await userEvent.click(screen.getByRole('option', { name: pl.directory.ever }));
    await userEvent.click(screen.getByRole('combobox', { name: pl.directory.rule }));
    await userEvent.click(screen.getByRole('option', { name: pl.directory.consentRule }));
    expect(screen.getByRole('combobox', { name: pl.directory.consentDefinition })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: pl.directory.grantState })).not.toBeInTheDocument();
  });
});
