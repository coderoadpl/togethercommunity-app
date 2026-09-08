import { describe, expect, it } from 'vitest';
import { publicOfferOutputSchema } from '#core/contract/index.js';
import bootSplash from '../apps/web/src/stories/fixtures/boot-splash.json';
import login from '../apps/web/src/stories/fixtures/login.json';
import { fixtureClient, fixtureErrors, fixtureExpectationErrors, fixturePendingCalls, fixtureQueriesReady, selectFixture } from '../apps/web/src/stories/fixture-client.js';

describe('page fixture client', () => {
  it('holds the splash identity while resolving the seed public offer', async () => {
    selectFixture(bootSplash);
    let settled = false;
    void fixtureClient.me().finally(() => { settled = true; });
    const offer = await fixtureClient.publicOffer();
    expect(offer.ok).toBe(true);
    if (offer.ok) expect(publicOfferOutputSchema.safeParse(offer.value).success).toBe(true);
    expect(settled).toBe(false);
    expect([...fixturePendingCalls]).toEqual(['me:[]']);
    expect([...fixtureErrors]).toEqual([]);
  });

  it('clears pending state on selection and reports unrecorded calls', async () => {
    selectFixture(bootSplash);
    void fixtureClient.me();
    selectFixture(login);
    expect([...fixturePendingCalls]).toEqual([]);
    expect(await fixtureClient.me()).toEqual(login.calls['me:[]']);
    expect(() => fixtureClient.publicPaymentConfig()).toThrow('Missing fixture call publicPaymentConfig:[] in login');
    expect([...fixtureErrors]).toEqual(['Missing fixture call publicPaymentConfig:[] in login']);
  });

  it('rejects expectations for calls that were not recorded', () => {
    expect(() => selectFixture({ ...login, pending: [{ call: 'missing:[]', queryKeys: [] }] })).toThrow('Unrecorded fixture expectation missing:[]');
    expect(() => selectFixture({ ...login, expectedErrors: { 'missing:[]': 'not_found' } })).toThrow('Unrecorded fixture expectation missing:[]');
    expect(() => selectFixture({ ...bootSplash, expectedErrors: { 'me:[]': 'unauthorized' } })).toThrow('Expected fixture error unauthorized for me:[]');
  });

  it('reports declared pending and error calls until they are exercised', async () => {
    selectFixture({ ...bootSplash, expectedErrors: { 'publicOffer:[]': 'not_found' }, calls: { ...bootSplash.calls, 'publicOffer:[]': { ok: false, error: { code: 'not_found' } } } });
    expect(fixtureExpectationErrors()).toEqual(['Unused fixture expectation me:[]', 'Unused fixture expectation publicOffer:[]']);
    void fixtureClient.me();
    await fixtureClient.publicOffer();
    expect(fixtureExpectationErrors()).toEqual([]);
  });

  it('allows multiple held queries for one call without ignoring other fetching queries', () => {
    selectFixture({ ...bootSplash, pending: [{ call: 'me:[]', queryKeys: [['identity'], ['identity', 'panel']] }] });
    expect(fixtureQueriesReady([['identity']])).toBe(false);
    void fixtureClient.me();
    void fixtureClient.me();
    expect(fixtureQueriesReady([['identity'], ['identity', 'panel']])).toBe(true);
    expect(fixtureQueriesReady([['identity'], ['publicOffer']])).toBe(false);
  });

  it('allows a held call outside the query cache', () => {
    selectFixture({ ...bootSplash, pending: [{ call: 'me:[]', queryKeys: [] }] });
    void fixtureClient.me();
    expect(fixtureQueriesReady([])).toBe(true);
    expect(fixtureQueriesReady([['publicOffer']])).toBe(false);
    expect(fixtureExpectationErrors()).toEqual([]);
  });
});
