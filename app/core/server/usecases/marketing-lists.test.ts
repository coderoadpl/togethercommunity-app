import { describe, expect, it } from 'vitest';

import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { createMarketingList, previewMarketingList } from './marketing-lists.js';

describe('list authorization and validation', () => {
  it('requires contact read alongside list read for address previews', async () => {
    expect(await previewMarketingList({ ...marketingContactCtx(), capabilities: ['marketing:list:read'] }, { listId: 'list' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('rejects cross-tenant rule references and unbounded rules', async () => {
    const deps = marketingContactDeps();
    deps.lists.validateRule = async () => false;
    expect(await createMarketingList(marketingContactCtx(), { key: 'products', name: 'Products', rule: { kind: 'product_grant', productIds: ['foreign'], state: 'active' } }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createMarketingList(marketingContactCtx(), { key: 'nested', name: 'Nested', rule: { kind: 'or', rules: [] } }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
