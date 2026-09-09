import { describe, expect, it } from 'vitest';

import { capabilitiesForApiKey } from '#core/domain/index.js';

import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { listMarketingContacts, upsertMarketingContact, updateMarketingContact } from './marketing-contacts.js';

describe('contact use-case boundaries', () => {
  it('denies members and unrelated API key scopes before repository access', async () => {
    const ctx = marketingContactCtx();
    for (const scopes of [['enrollment'], ['transactional'], ['import:users'], ['import:content']] as const) {
      expect(await listMarketingContacts({ ...ctx, capabilities: capabilitiesForApiKey({ scopes: [...scopes] }) }, {}, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    expect(await upsertMarketingContact({ identity: { ...ctx.identity, staffRole: null, memberId: 'member' } }, { email: 'contact@example.test' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('rejects email edits, invalid tag tokens and unqualified consent filters', async () => {
    expect(await updateMarketingContact(marketingContactCtx(), { contactId: 'id', email: 'new@example.test' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await upsertMarketingContact(marketingContactCtx(), { email: 'valid@example.test', tags: ['pipe|token'] }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await listMarketingContacts(marketingContactCtx(), { consentState: 'active' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
