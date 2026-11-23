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
      locationDescription: 'Next to the main entrance', address: { line1: 'Main Street 1', line2: '00-001 Warsaw' },
    } });
    expect(parcelLockerLookupView(lookup)).toEqual({
      status: 'found', code: 'KRA14A', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw', usable: true, reason: null,
    });
  });

  it('reads the not-found body as not found whether it comes with HTTP 200 or HTTP 404', async () => {
    expect(await directory(answering(() => json(fixture('point-not-found.json')))).lookup('ZZZ99999X')).toEqual({ kind: 'not_found' });
    expect(await directory(answering(() => json(fixture('point-not-found.json'), 404))).lookup('ZZZ99999X')).toEqual({ kind: 'not_found' });
  });

  it.each([
    ['the recorded routing error', () => json(fixture('routing-not-found.json'), 404)],
    ['a bare 404', () => json('{"error":"Not found"}', 404)],
    ['an empty 404', () => new Response(null, { status: 404 })],
    ['a 404 over the size cap', () => json(`{"status":404,"key":"point_not_found","padding":"${'A'.repeat(70_000)}"}`, 404)],
  ])('answers unavailable for %s instead of not found', async (_case, response) => {
    const fetchImpl = answering(response);
    expect(await directory(fetchImpl).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  const withStatus = (status: string): string => fixture('point-operating.json').replace('"status": "Operating"', `"status": "${status}"`);
  const typedSelection = {
    rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23 as const, carrier: 'inpost' as const,
    pickupPoint: { provider: 'inpost' as const, code: 'KRA14A', name: null, address: null }, allowedCountries: ['PL'],
  };

  it('refuses the sale for a point the carrier marks Disabled', async () => {
    const lookup = await directory(answering(() => json(withStatus('Disabled')))).lookup('KRA14A');
    expect(parcelLockerLookupView(lookup)).toMatchObject({ status: 'found', usable: false, reason: 'not_operating' });
    expect(applyPickupPointLookup(typedSelection, lookup)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_operating' } } });
  });

  it('reads a status the carrier has not documented as unavailable, so the sale goes on unverified', async () => {
    const lookup = await directory(answering(() => json(withStatus('Overloaded')))).lookup('KRA14A');
    expect(parcelLockerLookupView(lookup)).toEqual({ status: 'unavailable' });
    expect(applyPickupPointLookup(typedSelection, lookup)).toEqual({
      ok: true, value: { ...typedSelection, pickupPoint: { ...typedSelection.pickupPoint, verified: false } },
    });
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

  it('stops reading an oversized body at 64 KiB and cancels the rest of the stream', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(`{"name":"${'A'.repeat(16 * 1024)}`);
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel: () => { cancelled = true; },
    });
    expect(await directory(answering(() => new Response(endless, { status: 200 }))).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(Math.ceil((64 * 1024) / chunk.byteLength) + 2);
  });

  it('refuses a body whose declared length is above the cap before reading it', async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode(fixture('point-operating.json')));
        controller.close();
      },
      cancel: () => { cancelled = true; },
    });
    const response = new Response(body, { status: 200, headers: { 'content-length': String(64 * 1024 + 1) } });
    expect(await directory(answering(() => response)).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('gives up on a 404 body that never ends once the timeout fires', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Response(new ReadableStream<Uint8Array>({
      start: (controller) => {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      },
    }), { status: 404 }));
    expect(await directory(fetchImpl, 10).lookup('KRA14A')).toEqual({ kind: 'unavailable' });
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

  it('knows three operating lockers, one unknown code, one closed locker, one send-only point and one outage', async () => {
    expect(await outcome(FAKE_PICKUP_POINT_CODES.operating)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'WAW01M', name: 'Next to the main entrance' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.operatingNorth)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'WAW02M', name: 'By the north gate', address: 'North Street 2, 00-002 Warsaw' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.operatingSouth)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'WAW03M', address: 'South Street 3' } } });
    expect((await outcome('WAW04M')).ok).toBe(false);
    expect(await outcome(FAKE_PICKUP_POINT_CODES.notFound)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_found' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.notOperating)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_operating' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.wrongType)).toMatchObject({ ok: false, error: { details: { pickupPointReason: 'not_usable' } } });
    expect(await outcome(FAKE_PICKUP_POINT_CODES.unavailable)).toMatchObject({ ok: true, value: { pickupPoint: { code: 'OUTAGE01', verified: false } } });
  });

  it('normalises the code like the carrier does', async () => {
    expect(await fake.lookup(' waw01m ')).toMatchObject({ kind: 'found' });
  });
});
