import { describe, expect, it } from 'vitest';

import { createApiClient } from './http.js';
import { marketingContactsQuery, marketingContactQuery, marketingListsQuery, marketingListQuery, marketingContactImportQuery } from './queries.js';

describe('directory query cache identities', () => {
  it('separates contact filters, list details and durable import progress', () => {
    const api = createApiClient({ baseUrl: 'https://courses.example.org' });
    expect(marketingContactsQuery(api, { suppressed: true }).queryKey).not.toEqual(marketingContactsQuery(api, { suppressed: false }).queryKey);
    expect(marketingContactQuery(api, 'contact').queryKey).not.toEqual(marketingListQuery(api, 'contact').queryKey);
    expect(marketingListsQuery(api, {}).queryKey).toEqual(['marketing', 'lists', {}]);
    expect(marketingContactImportQuery(api, 'batch').queryKey).toEqual(['marketing', 'contact-import', 'batch']);
  });
});
