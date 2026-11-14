import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SHIPX_RECONCILE_MAX_PAGES, shipxSenderSchema, type ShipxShipmentRequest } from '#core/domain/index.js';
import type { ShipxCredentials } from '#core/server/index.js';

import { createShipxHttpClient } from './http.js';

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const ATTEMPTED_AT = '2026-11-08T10:00:00.000Z';

const credentials: ShipxCredentials = { organizationId: '1234', token: 'sandbox-secret-token', environment: 'sandbox' };

const sender = shipxSenderSchema.parse({
  name: 'Anna Sender', company: 'Example Workshop', email: 'shop@example.org', phone: '+48 500 600 700',
  street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001',
});

const lockerRequest: ShipxShipmentRequest = {
  reference: 'order-1',
  service: 'inpost_locker_standard',
  parcelTemplate: 'medium',
  targetPoint: 'BTO02M',
  receiver: { firstName: 'Jan', lastName: 'Kowalski', email: 'receiver@example.com', phone: '111222333', address: null },
  sender,
};

const listFixtureSchema = z.object({ items: z.array(z.record(z.string(), z.unknown())) }).passthrough();

const listFixture = () => listFixtureSchema.parse(JSON.parse(fixture('shipments-list.json')));

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { 'content-type': 'application/json' } });

const pdf = (): Response => new Response(new TextEncoder().encode('%PDF-1.4\n%%EOF\n'), { status: 200, headers: { 'content-type': 'application/pdf' } });

const requestOf = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) => {
  const [url, init] = fetchImpl.mock.calls[index] ?? [];
  const headers = new Headers(init?.headers);
  return {
    url: String(url),
    method: init?.method,
    authorization: headers.get('authorization'),
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
  };
};

describe('ShipX HTTP client', () => {
  it('creates a locker shipment at the sandbox organization URL with the bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(fixture('create-locker-response.json'), 201));
    const result = await createShipxHttpClient({ fetchImpl }).createShipment(credentials, lockerRequest);
    expect(result).toEqual({
      ok: true,
      value: {
        id: '12345', status: 'created', trackingNumber: null, reference: 'Test',
        offers: [], selectedOffer: null, transactions: [],
      },
    });
    const sent = requestOf(fetchImpl);
    expect(sent).toMatchObject({
      url: 'https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/1234/shipments',
      method: 'POST',
      authorization: 'Bearer sandbox-secret-token',
    });
    expect(sent.body).toEqual({
      sender: {
        company_name: 'Example Workshop', first_name: 'Anna', last_name: 'Sender', email: 'shop@example.org', phone: '500600700',
        address: { street: 'Factory Street', building_number: '7', city: 'Warsaw', post_code: '00-001', country_code: 'PL' },
      },
      receiver: { first_name: 'Jan', last_name: 'Kowalski', email: 'receiver@example.com', phone: '111222333' },
      parcels: [{ template: 'medium' }],
      custom_attributes: { target_point: 'BTO02M' },
      service: 'inpost_locker_standard',
      additional_services: [],
      reference: 'order-1',
    });
  });

  it('sends courier parcels as dimensions and weight with the receiver address', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(fixture('create-locker-response.json'), 201));
    await createShipxHttpClient({ fetchImpl }).createShipment({ ...credentials, environment: 'production' }, {
      ...lockerRequest,
      service: 'inpost_courier_standard',
      targetPoint: null,
      parcelTemplate: 'large',
      receiver: { ...lockerRequest.receiver, address: { street: 'Cybernetyki', buildingNumber: '10', city: 'Warszawa', postCode: '02-677', countryCode: 'PL' } },
    });
    const sent = requestOf(fetchImpl);
    expect(sent.url).toBe('https://api-shipx-pl.easypack24.net/v1/organizations/1234/shipments');
    expect(sent.body).toMatchObject({
      service: 'inpost_courier_standard',
      parcels: [{ dimensions: { length: '640', width: '380', height: '410', unit: 'mm' }, weight: { amount: '5', unit: 'kg' }, is_non_standard: false }],
      receiver: { address: { street: 'Cybernetyki', building_number: '10', city: 'Warszawa', post_code: '02-677', country_code: 'PL' } },
    });
    expect(sent.body).not.toHaveProperty('custom_attributes');
  });

  it('reads a confirmed shipment and the offers of a bought one', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(fixture('shipment-confirmed.json')))
      .mockResolvedValueOnce(json(fixture('buy-response.json')));
    const client = createShipxHttpClient({ fetchImpl });
    expect(await client.getShipment(credentials, '12345')).toEqual({
      ok: true,
      value: {
        id: '12345', status: 'confirmed', trackingNumber: '523000015611700083038270', reference: 'Test',
        offers: [], selectedOffer: { id: '1456', status: 'bought', service: 'inpost_locker_standard', unavailabilityReasons: [] },
        transactions: [{ status: 'success' }],
      },
    });
    expect(requestOf(fetchImpl, 0)).toMatchObject({ url: 'https://sandbox-api-shipx-pl.easypack24.net/v1/shipments/12345', method: 'GET' });
    expect(await client.buyOffer(credentials, '1', '1456')).toMatchObject({
      ok: true,
      value: { id: '1', status: 'unknown', selectedOffer: { id: '1456', status: 'selected', service: 'inpost_locker_standard' } },
    });
    expect(requestOf(fetchImpl, 1)).toMatchObject({ url: 'https://sandbox-api-shipx-pl.easypack24.net/v1/shipments/1/buy', method: 'POST', body: { offer_id: 1456 } });
  });

  it('maps a 4xx body to a sanitised rejection and does not retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(fixture('error-validation-failed.json'), 400));
    const result = await createShipxHttpClient({ fetchImpl }).getShipment(credentials, '12345');
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'shipx_rejected',
        message: 'InPost rejected the shipment data',
        details: {
          status: 400,
          error: 'validation_failed',
          description: 'Some of data sent in payload are invalid. Check details for more information.',
          fields: { email: ['invalid'] },
        },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('sandbox-secret-token');
  });

  it('retries a label download once on 5xx and reports ShipX as unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await createShipxHttpClient({ fetchImpl }).fetchLabel(credentials, '12345')).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX is unavailable (HTTP 502); retry in a moment' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a label download once after a network error and returns the second answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(pdf());
    expect(await createShipxHttpClient({ fetchImpl }).fetchLabel(credentials, '12345')).toMatchObject({ ok: true, value: { contentType: 'application/pdf' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads a shipment once without retrying, because the caller polls', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await createShipxHttpClient({ fetchImpl }).getShipment(credentials, '12345')).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never repeats an offer purchase, so a lost answer cannot pay twice', async () => {
    const network = vi.fn<typeof fetch>(async () => { throw new TypeError('socket hang up'); });
    expect(await createShipxHttpClient({ fetchImpl: network }).buyOffer(credentials, '12345', '1456')).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
    expect(network).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    expect(await createShipxHttpClient({ fetchImpl: unavailable }).buyOffer(credentials, '12345', '1456')).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout running until the body is read, so a stalled body cannot hang the request', async () => {
    const stalled = (init: RequestInit | undefined, contentType: string) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(contentType === 'application/pdf' ? '%PDF-1.4' : '{"id":'));
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    }), { status: 200, headers: { 'content-type': contentType } });
    const shipment = vi.fn<typeof fetch>(async (_url, init) => stalled(init, 'application/json'));
    expect(await createShipxHttpClient({ fetchImpl: shipment, timeoutMs: 20 }).createShipment(credentials, lockerRequest)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX did not answer in time; retry in a moment' },
    });
    expect(shipment).toHaveBeenCalledTimes(1);
    const label = vi.fn<typeof fetch>(async (_url, init) => stalled(init, 'application/pdf'));
    expect(await createShipxHttpClient({ fetchImpl: label, timeoutMs: 20 }).fetchLabel(credentials, '12345')).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX did not answer in time; retry in a moment' },
    });
    expect(label).toHaveBeenCalledTimes(2);
  });

  it('reports a malformed success body as unreadable without retrying a creation', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json('{"id":'));
    expect(await createShipxHttpClient({ fetchImpl }).createShipment(credentials, lockerRequest)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX returned an unreadable answer' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never repeats a shipment creation, so a lost answer cannot create a duplicate', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError('socket hang up'); });
    expect(await createShipxHttpClient({ fetchImpl }).createShipment(credentials, lockerRequest)).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts a request after the timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect(await createShipxHttpClient({ fetchImpl, timeoutMs: 5 }).getShipment(credentials, '12345')).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX did not answer in time; retry in a moment' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('finds the shipment of an order reference among the 50 newest organization shipments', async () => {
    const list = listFixture();
    const [template] = list.items;
    const page = json(JSON.stringify({ ...list, items: ['order-9', 'order-1'].map((reference, index) => ({ ...template, id: 5000 - index, reference })) }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(page);
    const found = await createShipxHttpClient({ fetchImpl }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT);
    expect(found).toMatchObject({ ok: true, value: { id: '4999', reference: 'order-1', status: 'confirmed', trackingNumber: '523000015611700083038270' } });
    expect(requestOf(fetchImpl, 0)).toMatchObject({
      url: 'https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/1234/shipments?page=1&per_page=50&sort_by=created_at&sort_order=desc',
      method: 'GET',
      authorization: 'Bearer sandbox-secret-token',
    });
  });

  it('pages past a busy first page to the shipment created by the unconfirmed attempt', async () => {
    const list = listFixture();
    const [template] = list.items;
    const recent = (from: number) => Array.from({ length: 50 }, (_value, index) => ({
      ...template, id: from - index, reference: `other-${String(from - index)}`, created_at: '2026-11-08T11:05:00.000+01:00',
    }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(JSON.stringify({ ...list, items: recent(9000) })))
      .mockResolvedValueOnce(json(JSON.stringify({ ...list, page: 2, items: [...recent(8950).slice(0, 10), { ...template, id: 4242, reference: 'order-1', created_at: '2026-11-08T11:00:01.000+01:00' }] })));
    expect(await createShipxHttpClient({ fetchImpl }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toMatchObject({
      ok: true,
      value: { id: '4242', reference: 'order-1' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestOf(fetchImpl, 1).url).toBe('https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/1234/shipments?page=2&per_page=50&sort_by=created_at&sort_order=desc');
  });

  it('stops paging at the end of the list and after a bounded number of pages', async () => {
    const list = listFixture();
    const [template] = list.items;
    const short = vi.fn<typeof fetch>(async () => json(JSON.stringify({
      ...list, items: [{ ...template, id: 1, reference: 'other', created_at: '2026-11-08T11:30:00.000+01:00' }],
    })));
    expect(await createShipxHttpClient({ fetchImpl: short }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toEqual({ ok: true, value: null });
    expect(short).toHaveBeenCalledTimes(1);
    const endless = vi.fn<typeof fetch>(async () => json(JSON.stringify({
      ...list,
      items: Array.from({ length: 50 }, (_value, index) => ({ ...template, id: 9000 - index, reference: 'other', created_at: '2026-11-08T11:30:00.000+01:00' })),
    })));
    expect(await createShipxHttpClient({ fetchImpl: endless }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toEqual({ ok: true, value: null });
    expect(endless).toHaveBeenCalledTimes(SHIPX_RECONCILE_MAX_PAGES);
    expect(requestOf(endless, SHIPX_RECONCILE_MAX_PAGES - 1).url).toContain(`page=${String(SHIPX_RECONCILE_MAX_PAGES)}&`);
  });

  it('stops at the first page whose entries are older than the attempt and never retries a page', async () => {
    const list = listFixture();
    const [template] = list.items;
    const full = vi.fn<typeof fetch>(async () => json(JSON.stringify({
      ...list,
      items: Array.from({ length: 50 }, (_value, index) => ({ ...template, id: 9000 - index, reference: `other-${String(index)}` })),
    })));
    expect(await createShipxHttpClient({ fetchImpl: full }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toEqual({ ok: true, value: null });
    expect(full).toHaveBeenCalledTimes(1);
    const failing = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    expect(await createShipxHttpClient({ fetchImpl: failing }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable' },
    });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('reports an unreadable shipment list as unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json('{"unexpected":true}'));
    expect(await createShipxHttpClient({ fetchImpl }).findShipmentByReference(credentials, 'order-1', ATTEMPTED_AT)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost ShipX returned an unexpected shipment list' },
    });
  });

  it('downloads the A6 PDF label for one shipment', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => pdf());
    const result = await createShipxHttpClient({ fetchImpl }).fetchLabel(credentials, '12345');
    expect(result).toMatchObject({ ok: true, value: { contentType: 'application/pdf' } });
    expect(requestOf(fetchImpl)).toMatchObject({
      url: 'https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/1234/shipments/labels',
      method: 'POST',
      body: { shipment_ids: [12345], format: 'Pdf', type: 'A6' },
    });
  });

  it('maps a label requested before payment and refuses a non-PDF body', async () => {
    const unpaid = vi.fn<typeof fetch>(async () => json(fixture('error-invalid-action.json'), 400));
    expect(await createShipxHttpClient({ fetchImpl: unpaid }).fetchLabel(credentials, '12345')).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', message: 'The InPost label is available only after the shipment is paid', details: { error: 'invalid_action' } },
    });
    const html = vi.fn<typeof fetch>(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await createShipxHttpClient({ fetchImpl: html }).fetchLabel(credentials, '12345')).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
  });

  it('reports an unexpected shipment body as unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json('{"unexpected":true}'));
    expect(await createShipxHttpClient({ fetchImpl }).getShipment(credentials, '12345')).toMatchObject({ ok: false, error: { code: 'shipx_unavailable' } });
  });
});
