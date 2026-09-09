import { describe, expect, it } from 'vitest';

import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { syncMarketingMemberContacts } from './marketing-member-contacts.js';

describe('member synchronization budget', () => {
  it('denies marketing API keys worker privileges', async () => {
    expect(await syncMarketingMemberContacts({ ...marketingContactCtx(), capabilities: ['marketing:contact:write'] }, { maxJobs: 100, deadlineAt: '2026-09-08T10:01:00.000Z' }, marketingContactDeps())).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
  it('does no projection writes after the invocation deadline', async () => {
    const deps = marketingContactDeps();
    deps.memberSync.next = async () => ({ memberId: 'id', revision: 2, email: 'member@example.test', displayName: null });
    expect(await syncMarketingMemberContacts(marketingContactCtx(), { maxJobs: 100, deadlineAt: '2026-09-08T09:00:00.000Z' }, deps)).toEqual({ ok: true, value: { processed: 0, pending: true } });
  });
});
