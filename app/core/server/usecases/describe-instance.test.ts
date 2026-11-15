import { describe, expect, it } from 'vitest';
import { instanceDescriptionSchema } from '#core/domain/index.js';
import { describeInstance } from './describe-instance.js';

describe('describeInstance', () => {
  it('reports the configured base domain of a multi-tenant instance', () => {
    const description = describeInstance({ baseDomain: 'togethercommunity.app', singleTenantMode: false, databaseIdentity: '0123456789abcdef' });
    expect(description).toEqual({ baseDomain: 'togethercommunity.app', singleTenant: false, databaseIdentity: '0123456789abcdef' });
    expect(instanceDescriptionSchema.parse(description)).toEqual(description);
  });

  it('reports no base domain for a single-tenant instance even though routing falls back to its application host', () => {
    expect(describeInstance({ baseDomain: 'courses.togethercommunity.app', singleTenantMode: true, databaseIdentity: null }))
      .toEqual({ baseDomain: null, singleTenant: true, databaseIdentity: null });
  });
});
