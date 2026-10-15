import { describe, expect, it } from 'vitest';
import { attributionFromMetadata, attributionFromSearchParams, attributionMetadata, attributionSchema, attributionToSearchParams } from './attribution.js';

describe('checkout attribution', () => {
  it('round-trips every campaign field through return URL parameters', () => {
    const attribution = { utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'Launch + 2026', utmContent: 'a/b=c', utmTerm: '@course', fbclid: 'Click_1-2.3', gclid: 'Google_1' };
    const params = attributionToSearchParams(attribution);
    expect(attributionFromSearchParams(new URLSearchParams(params.toString()))).toEqual(attribution);
    expect(attributionToSearchParams(undefined).toString()).toBe('');
  });

  it('trims all seven fields and preserves accepted punctuation', () => {
    expect(attributionFromSearchParams(new URLSearchParams('utm_source=+meta+&utm_medium=paid&utm_campaign=Launch+2026&utm_content=a._~%3A%2F%2B%3D%40+-&utm_term=course&fbclid=Click_1-2.3&gclid=Google_1'))).toEqual({
      utmSource: 'meta', utmMedium: 'paid', utmCampaign: 'Launch 2026', utmContent: 'a._~:/+=@ -', utmTerm: 'course', fbclid: 'Click_1-2.3', gclid: 'Google_1',
    });
  });

  it.each(['', '   ', '<script>', 'a&b', 'café', 'a'.repeat(201), 42, null])('drops invalid values without rejecting checkout: %s', (value) => {
    expect(attributionSchema.parse({ utmSource: 'meta', utmMedium: value, fbclid: value })).toEqual({ utmSource: 'meta' });
  });

  it('drops click-id spaces and returns no attribution for empty input', () => {
    expect(attributionSchema.parse({ fbclid: 'has spaces', gclid: 'slash/id' })).toBeUndefined();
    expect(attributionSchema.parse({})).toBeUndefined();
    expect(attributionSchema.parse(undefined)).toBeUndefined();
    expect(attributionSchema.parse({ utmSource: 'a'.repeat(200) })?.utmSource).toHaveLength(200);
  });

  it('round trips metadata with the server capture time and rejects missing or invalid times', () => {
    const attribution = { utmSource: 'meta', fbclid: 'X', capturedAt: '2026-10-15T10:00:00.000Z' };
    expect(attributionFromMetadata(attributionMetadata(attribution))).toEqual(attribution);
    expect(attributionFromMetadata({ utm_source: 'meta' })).toBeNull();
    expect(attributionFromMetadata({ utm_source: 'meta', attribution_at: 'invalid' })).toBeNull();
    expect(attributionMetadata(undefined)).toEqual({});
  });
});
