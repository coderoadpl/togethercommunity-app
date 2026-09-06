import { describe, expect, it } from 'vitest';

import { type AlertGateState, decideAlert, parseState } from './alert-gate.js';

const state = (overrides: Partial<AlertGateState> = {}): AlertGateState => ({
  green: true,
  paging: false,
  failing: [],
  cleared: ['health', 'deep-health'],
  ...overrides,
});

describe('alert gate', () => {
  it('stays observe-only until the monitor has been green on this environment', () => {
    const decision = decideAlert({
      previous: null,
      previousConclusion: null,
      failing: ['health'],
      checks: ['health'],
    });

    expect(decision.shouldPage).toBe(false);
    expect(decision.observeOnly).toBe(true);
    expect(decision.next.green).toBe(false);
  });

  it('does not page on the first green run either, but arms the monitor', () => {
    const decision = decideAlert({
      previous: null,
      previousConclusion: null,
      failing: [],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(false);
    expect(decision.next.green).toBe(true);
    expect(decision.next.cleared).toEqual(['deep-health', 'health']);
  });

  it('pages when a green monitor turns red', () => {
    const decision = decideAlert({
      previous: state(),
      previousConclusion: 'success',
      failing: ['deep-health'],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(true);
    expect(decision.pageable).toEqual(['deep-health']);
    expect(decision.next.paging).toBe(true);
    expect(decision.next.failing).toEqual(['deep-health']);
  });

  it('never pages twice in a row for the same failing set', () => {
    const decision = decideAlert({
      previous: state({ paging: true, failing: ['deep-health'] }),
      previousConclusion: 'failure',
      failing: ['deep-health'],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(false);
    expect(decision.observeOnly).toBe(false);
    expect(decision.next.paging).toBe(true);
  });

  it('keeps the same failing set quiet across a run the gate never reached', () => {
    const decision = decideAlert({
      previous: state({ paging: true, failing: ['deep-health'] }),
      previousConclusion: 'skipped',
      failing: ['deep-health'],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(false);
  });

  it('pages when the previous run failed outside the gate', () => {
    const decision = decideAlert({
      previous: state(),
      previousConclusion: 'failure',
      failing: ['deep-health'],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(true);
  });

  it('pages again once the failing set changes', () => {
    const decision = decideAlert({
      previous: state({ paging: true, failing: ['deep-health'] }),
      previousConclusion: 'failure',
      failing: ['deep-health', 'health'],
      checks: ['health', 'deep-health'],
    });

    expect(decision.shouldPage).toBe(true);
    expect(decision.reason).toContain('deep-health,health');
  });

  it('reports a recovery only after a page went out', () => {
    const recovered = decideAlert({
      previous: state({ paging: true, failing: ['deep-health'] }),
      previousConclusion: 'failure',
      failing: [],
      checks: ['health', 'deep-health'],
    });
    const quiet = decideAlert({
      previous: state({ paging: false, failing: ['deep-health'] }),
      previousConclusion: 'failure',
      failing: [],
      checks: ['health', 'deep-health'],
    });

    expect(recovered.recovered).toBe(true);
    expect(recovered.next.paging).toBe(false);
    expect(recovered.next.failing).toEqual([]);
    expect(quiet.recovered).toBe(false);
  });

  it('lets a check added to an armed monitor inherit observe-only until it is green', () => {
    const added = decideAlert({
      previous: state(),
      previousConclusion: 'success',
      failing: ['storage-presign'],
      checks: ['health', 'deep-health', 'storage-presign'],
    });

    expect(added.shouldPage).toBe(false);
    expect(added.observeOnly).toBe(true);
    expect(added.next.cleared).not.toContain('storage-presign');

    const green = decideAlert({
      previous: added.next,
      previousConclusion: 'failure',
      failing: [],
      checks: ['health', 'deep-health', 'storage-presign'],
    });

    expect(green.next.cleared).toContain('storage-presign');
    expect(decideAlert({
      previous: green.next,
      previousConclusion: 'success',
      failing: ['storage-presign'],
      checks: ['health', 'deep-health', 'storage-presign'],
    }).shouldPage).toBe(true);
  });

  it('pages for the cleared checks even while a new one is still observed', () => {
    const decision = decideAlert({
      previous: state(),
      previousConclusion: 'success',
      failing: ['health', 'storage-presign'],
      checks: ['health', 'deep-health', 'storage-presign'],
    });

    expect(decision.shouldPage).toBe(true);
    expect(decision.pageable).toEqual(['health']);
  });

  it('pages for a failure outside the measured inventory instead of observing it forever', () => {
    const decision = decideAlert({
      previous: state(),
      previousConclusion: 'success',
      failing: ['unreachable'],
      checks: [],
    });

    expect(decision.shouldPage).toBe(true);
    expect(decision.pageable).toEqual(['unreachable']);
    expect(decision.next.cleared).toEqual(['deep-health', 'health']);
  });

  it('reads a recorded state and falls back to observe-only on a damaged one', () => {
    expect(parseState('{"green":true,"paging":false,"failing":["a"],"cleared":["a","b"]}'))
      .toEqual({ green: true, paging: false, failing: ['a'], cleared: ['a', 'b'] });
    expect(parseState('not json')).toBeNull();
    expect(parseState('{"green":"yes","cleared":[1,"a"]}'))
      .toEqual({ green: false, paging: false, failing: [], cleared: ['a'] });
  });
});
