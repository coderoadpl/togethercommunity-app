import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { applyPickupPointLookup, parcelLockerLookupView } from '#core/domain/index.js';

import { createFakePickupPointDirectory, FAKE_PICKUP_POINT_CODES } from './fake.js';
import { createInpostPointsDirectory } from './points.js';

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

const answering = (response: () => Response) => vi.fn<typeof fetch>(async () => response());

const directory = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  createInpostPointsDirectory({ fetchImpl, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

describe('InPost points directory', () => {
  it('asks the fixed production host once, without credentials, and reads the recorded operating locker', async () => {
    const fetchImpl = answering(() => json(fixture('point-operating.json')));
    const lookup = await directory(fetchImpl).lookup(' kra14a ');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api-shipx-pl.easypack24.net/v1/points/KRA14A');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(lookup).toEqual({ kind: 'found', point: {
      name: 'KRA14A', status: 'Operating', types: ['parcel_locker'], functions: expect.arrayContaining(['parcel_collect']),
      locationDescription: 'Przy markecie Kaufland', address: { line1: 'os. Kombatantów 16', line2: '31-630 Kraków' },
    } });
    expect(parcelLockerLookupView(lookup)).toEqual({
      status: 'found', code: 'KRA14A', name: 'Przy markecie Kaufland', address: 'os. Kombatantów 16, 31-630 Kraków', usable: true, reason: null,
    });
  });

  it('reads the HTTP 200 not-found body and a real HTTP 404 as not found', async () => {
    expect(await directory(answering(() => json(fixture('point-not-found.json')))).lookup('ZZZ99999X')).toEqual({ kind: 'not_found' });
    expect(await directory(answering(() => json('{"error":"Not found"}', 404))).lookup('ZZZ99999X')).toEqual({ kind: 'not_found' });
  });

  it.each([
    ['point-removed.derived.json', 'not_operating'],
    ['point-non-operating.derived.json', 'not_operating'],
    ['point-wrong-type.derived.json', 'not_usable'],
    ['point-send-only.derived.json', 'not_usable'],
  ])('reads %s as a point the checkout refuses with %s', async (name, reason) => {
    const lookup = await directory(answering(() => json(fixture(name)))).lookup('KRA14A');
    expect(lookup).toMatchObject({ kind: 'found' });
    expect(parcelLockerLookupView(lookup)).toMatchObject({ status: 'found', usable: false, reason });
  });

  it.each([
    ['a server error', () => json('{"error":"Internal"}', 503)],
    ['a refusal', () => json('{"status":403,"error":"Forbidden"}', 403)],
    ['malformed JSON', () => json('{"name":')],
    ['an unexpected shape', () => json('{"name":"KRA14A","status":"Operating"}')],
    ['an answer for another point', () => json(fixture('point-operating.json').replace('"name": "KRA14A"', '"name": "WAW01M"'))],
    ['an oversized body', () => json(`{"name":"${'A'.repeat(70_000)}"}`)],
  ])('answers unavailable for %s after one request', async (_case, response) => {
    const fetchImpl = answering(response);
    expect(await directory(fetchImpl).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('answers unavailable for a network error without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); });
    expect(await directory(fetchImpl).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout and answers unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    expect(await directory(fetchImpl, 10).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never sends a malformed code to the carrier', async () => {
    const fetchImpl = answering(() => json(fixture('point-operating.json')));
    expect(await directory(fetchImpl).lookup('../shipments')).toEqual({ kind: 'not_found' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fake pickup point directory', () => {
  const fake = createFakePickupPointDirectory();
  const selection = {
    rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const,
    pickupPoint: { provider: 'inpost' as const, code: 'X', name: null, address: null }, allowedCountries: ['PL'],
  };
  const outcome = async (code: string) => applyPickupPointLookup({ ...selection, pickupPoint: { ...selection.pickupPoint, code } }, await fake.lookup(code));

  it('knows one operating locker, one unknown code, one closed locker, one send-only point and one outage', async () => {
    expect(await outcome(FAKE_PICKUP_POINT_CODES.operating)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'WAW01M', name: 'Next to the main entrance' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.notFound)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_found' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.notOperating)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_operating' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.wrongType)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_usable' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.unavailable)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'OUTAGE01', verified: false } } });
  });

  it('normalises the code like the carrier does', async () => {
    expect(await fake.lookup(' waw01m ')).toMatchObject({ kind: 'found' });
  });
});
