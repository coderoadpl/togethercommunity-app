import { describe, expect, it } from 'vitest';
import { publicOfferOutputSchema } from '#core/contract/index.js';
import bootSplash from '../apps/web/src/stories/fixtures/boot-splash.json';
import login from '../apps/web/src/stories/fixtures/login.json';
import { fixtureClient, fixtureErrors, fixturePendingCalls, selectFixture } from '../apps/web/src/stories/fixture-client.js';

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
});
