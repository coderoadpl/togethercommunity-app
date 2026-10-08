import { describe, expect, it, vi } from 'vitest';

import { orderListItemSchema } from '#core/domain/index.js';
import { tenantDomainFixture, tenantDomainRepositoryStub } from '../testing/tenant-domain-fakes.js';
import { getPublicOrderQr } from './public-order-qr.js';

const token = 'b'.repeat(64);
const order = orderListItemSchema.parse({ id: 'order-number', tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 10500, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: '2026-10-08T12:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed material', couponCode: null, verificationToken: token });
const harness = () => ({
  appBaseUrl: 'http://localhost:48730', baseDomain: 'localhost', singleTenantMode: false,
  tenantDomains: tenantDomainRepositoryStub({ listByTenant: async () => [tenantDomainFixture({ id: 'domain', tenantId: 'workspace', domain: 'shop.example.org', verified: true })] }),
  orderVerification: { findByToken: vi.fn(async (tenantId: string, reference: string) => tenantId === order.tenantId && reference === token ? order : null) },
  renderQrPng: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
});

describe('public order QR image', () => {
  it('encodes only the HTTPS staff URL at the verified workspace host', async () => {
    const deps = harness();
    const result = await getPublicOrderQr({ id: 'workspace', slug: 'workspace' }, token, deps);
    expect(result).toEqual({ ok: true, value: new Uint8Array([137, 80, 78, 71]) });
    expect(deps.renderQrPng).toHaveBeenCalledWith(`https://shop.example.org/panel/orders/verify/${token}`);
    expect(deps.orderVerification.findByToken).toHaveBeenCalledWith('workspace', token);
  });
  it.each(['order-number', 'invalid/path', 'a'.repeat(64)])('rejects order numbers and unknown tokens: %s', async (reference) => {
    const deps = harness();
    expect(await getPublicOrderQr({ id: 'workspace', slug: 'workspace' }, reference, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(deps.renderQrPng).not.toHaveBeenCalled();
  });
  it('does not resolve the same token through another workspace', async () => {
    const deps = harness();
    expect(await getPublicOrderQr({ id: 'other', slug: 'other' }, token, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(deps.renderQrPng).not.toHaveBeenCalled();
  });
});
