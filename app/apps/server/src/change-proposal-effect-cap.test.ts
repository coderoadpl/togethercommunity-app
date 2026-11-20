import { describe, expect, it } from 'vitest';

import {
  CHANGE_PROPOSAL_LIMITS,
  changeProposalEffectWithinLimit,
  PRODUCT_SAFETY_WARNINGS_MAX_LENGTH,
  updateProductInputSchema,
  VARIANT_FIELD_MAX_LENGTH,
  type ChangeProposalEffect,
} from '#core/domain/index.js';

import { DEFAULT_API_BODY_LIMIT } from './body-limits.js';

const SIX_BYTE_ESCAPED_UNIT = '\u0001';

const longest = (units: number, fill = SIX_BYTE_ESCAPED_UNIT): string => fill.repeat(units);

const encodedBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const schemaBoundedSide = () => ({
  title: longest(200),
  description: longest(50_000),
  slug: longest(100),
  vatExemptionBasis: longest(256),
  variantGroup: longest(VARIANT_FIELD_MAX_LENGTH),
  variantLabel: longest(VARIANT_FIELD_MAX_LENGTH),
  personalization: {
    label: longest(80), description: longest(1_000), inputLabel: longest(80), maxLength: 500, condition: longest(1_000),
  },
  compliance: {
    manufacturerName: longest(200), manufacturerAddress: longest(300), manufacturerEmail: longest(254), modelIdentifier: longest(100),
    batchIdentifier: longest(100), safetyWarnings: longest(PRODUCT_SAFETY_WARNINGS_MAX_LENGTH),
    instructionsUrl: longest(DEFAULT_API_BODY_LIMIT, 'u'),
  },
  coverUrl: longest(DEFAULT_API_BODY_LIMIT, 'u'),
  type: 'digital_download', visibility: 'unlisted', salesChannel: 'sales_links_only', deliveryMethod: 'pickup',
  parcelTemplate: 'medium', vatRate: 'exempt', priceCents: Number.MAX_SAFE_INTEGER, currency: 'PLN', published: false, exists: true,
});

describe('the stored-effect cap', () => {
  it('holds the largest product change: every length-bounded text at its schema maximum as six-byte JSON escapes, every unbounded URL at a whole request body, before and after', () => {
    expect(updateProductInputSchema.safeParse({ id: 'p', description: longest(50_000) }).success).toBe(true);
    expect(updateProductInputSchema.safeParse({ id: 'p', description: longest(50_001) }).success).toBe(false);
    expect(encodedBytes(SIX_BYTE_ESCAPED_UNIT)).toBe(2 + 6);

    const effect: ChangeProposalEffect = Object.fromEntries(
      Object.entries(schemaBoundedSide()).map(([field, value]) => [field, { before: value, after: value }]),
    );

    expect(encodedBytes(effect)).toBeLessThanOrEqual(CHANGE_PROPOSAL_LIMITS.effectMaxBytes);
    expect(changeProposalEffectWithinLimit(effect)).toBe(true);
  });
});
