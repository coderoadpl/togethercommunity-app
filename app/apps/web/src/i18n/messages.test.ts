import { describe, expect, it } from 'vitest';

import { en } from './en.js';
import { format, type Messages } from './messages.js';
import { pl } from './pl.js';

/**
 * The `: Messages` annotation on each dictionary already makes a missing key a
 * compile error; this `satisfies` re-states that contract at the call site and
 * the runtime check below backstops structural drift (e.g. a key present as a
 * plain string in one language and a param function in the other).
 */
const dictionaries = { pl, en } satisfies Record<string, Messages>;

const keyShape = (value: unknown): unknown => {
  if (typeof value === 'function') return 'fn';
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, keyShape(child)]),
    );
  }
  return 'leaf';
};

const plainStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(plainStrings);
  return [];
};

describe('i18n dictionaries', () => {
  it('never names the retired sending-settings page', () => {
    expect(plainStrings(pl).filter((text) => text.includes('Ustawienia wysyłki'))).toEqual([]);
    expect(plainStrings(en).filter((text) => text.includes('Sending settings'))).toEqual([]);
  });

  it('share an identical key structure across every language', () => {
    expect(keyShape(dictionaries.en)).toEqual(keyShape(dictionaries.pl));
  });

  it('interpolates named params through the format helper', () => {
    expect(format('checkout · {tenant}', { tenant: 'Acme' })).toBe('checkout · Acme');
    expect(pl.checkout.eyebrow({ tenant: 'Acme' })).toBe('Płatność · Acme');
    expect(en.checkout.eyebrow({ tenant: 'Acme' })).toBe('Checkout · Acme');
  });
});
