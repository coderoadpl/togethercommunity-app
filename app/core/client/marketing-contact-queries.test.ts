import { describe, expect, it } from 'vitest';

import { createApiClient } from './http.js';
import { marketingDirectoryActions } from './queries.js';

describe('directory query cache identities', () => {
  it('scopes Studio invalidation and progress to the tenant', () => {
    const directory = marketingDirectoryActions(createApiClient({ baseUrl: 'https://courses.example.org' }));
    expect(directory.contacts('studio', {}).queryKey).not.toEqual(directory.contacts('acme', {}).queryKey);
    expect(directory.import('studio', { importId: 'batch' }).queryKey.slice(0, 3)).toEqual(directory.invalidates('studio').queryKey);
    expect(directory.list('studio', { listId: 'list', consentDefinitionId: 'one' }).queryKey).not.toEqual(directory.list('studio', { listId: 'list', consentDefinitionId: 'two' }).queryKey);
  });
  it('separates contact filters, list details and durable import progress', () => {
    const directory = marketingDirectoryActions(createApiClient({ baseUrl: 'https://courses.example.org' }));
    expect(directory.contacts('studio', { suppressed: true }).queryKey).not.toEqual(directory.contacts('studio', { suppressed: false }).queryKey);
    expect(directory.contact('studio', { contactId: 'contact' }).queryKey).not.toEqual(directory.list('studio', { listId: 'contact' }).queryKey);
    expect(directory.lists('studio', {}).queryKey).toEqual(['marketing', 'directory', 'studio', 'lists', {}]);
    expect(directory.import('studio', { importId: 'batch' }).queryKey).toEqual(['marketing', 'directory', 'studio', 'import', { importId: 'batch' }]);
  });
});
