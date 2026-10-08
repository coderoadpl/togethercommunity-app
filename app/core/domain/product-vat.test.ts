import { describe, expect, it } from 'vitest';

import { tenantSettingsSchema } from './tenant.js';
import { defaultProductVat, resolveProductVat, splitProductGross } from './product-vat.js';

describe('product VAT', () => {
  it.each([
    [5, 7524, 376], [8, 7315, 585], [23, 6423, 1477], ['exempt', 7900, 0],
  ] as const)('splits gross cents at %s', (rate, netCents, vatCents) => {
    expect(splitProductGross(7900, rate)).toEqual({ grossCents: 7900, netCents, vatCents });
  });

  it.each([
    { invoiceExemptionBasisKind: null, invoiceExemptionBasis: 'Exemption provision' },
    { invoiceExemptionBasisKind: 'art_43_1', invoiceExemptionBasis: 'art. 43 ust. 1' },
  ] as const)('rejects invalid inherited exemption settings: %o', (exemption) => {
    const settings = tenantSettingsSchema.parse({
      name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null,
      invoiceVatMode: 'exempt', ...exemption,
    });
    expect(resolveProductVat({}, settings)).toBeNull();
    expect(resolveProductVat({ vatRate: 'exempt' }, settings)).toBeNull();
    expect(resolveProductVat({ vatRate: 'exempt', vatExemptionBasis: exemption.invoiceExemptionBasis }, settings)).toBeNull();
  });

  it('does not invent a rate for an unconfigured workspace', () => {
    expect(defaultProductVat({}, null)).toEqual({ vatRate: null, vatExemptionBasis: null });
    expect(resolveProductVat({ vatRate: 'exempt' }, null)).toBeNull();
    expect(resolveProductVat({ vatRate: 'exempt', vatExemptionBasis: 'Section 1' }, null)).toEqual({ kind: 'exempt', basisKind: 'other', basis: 'Section 1' });
  });
});
