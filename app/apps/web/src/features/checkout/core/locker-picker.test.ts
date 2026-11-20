import { describe, expect, it } from 'vitest';

import { closedLockerPicker, confirmablePoint, lockerEntry, reduceLockerPicker, type LockerPickerEvent, type LockerPickerState } from './locker-picker.js';

const point = { code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, 30-001 Cracow' };
const other = { code: 'WAW01M', name: null, address: null };
const run = (...events: LockerPickerEvent[]): LockerPickerState => events.reduce(reduceLockerPicker, closedLockerPicker);
const map = { status: 'map', token: 'public-map-token' } as const;

describe('locker picker state', () => {
  it('opens without a candidate, so the confirm button starts disabled even when a locker was chosen before', () => {
    const opened = run({ type: 'opened' });
    expect(opened.picker).toEqual({ status: 'open', candidate: null, map: 'shown' });
    expect(confirmablePoint(opened)).toBeNull();
    expect(confirmablePoint(run({ type: 'opened' }, { type: 'pointPicked', point }, { type: 'confirmed' }, { type: 'opened' }))).toBeNull();
  });

  it('offers the last point picked on the map for confirmation', () => {
    expect(confirmablePoint(run({ type: 'opened' }, { type: 'pointPicked', point }))).toEqual(point);
    expect(confirmablePoint(run({ type: 'opened' }, { type: 'pointPicked', point }, { type: 'pointPicked', point: other }))).toEqual(other);
  });

  it.each(['confirmed', 'cancelled'] as const)('closes on %s and forgets the candidate', (type) => {
    const closed = run({ type: 'opened' }, { type: 'pointPicked', point }, { type });
    expect(closed).toEqual(closedLockerPicker);
    expect(confirmablePoint(closed)).toBeNull();
  });

  it('ignores points that arrive while the picker is closed', () => {
    expect(run({ type: 'pointPicked', point })).toEqual(closedLockerPicker);
    expect(run({ type: 'opened' }, { type: 'cancelled' }, { type: 'pointPicked', point })).toEqual(closedLockerPicker);
  });

  it('shows the failure inside the open picker, offers nothing to confirm and remembers it after closing', () => {
    const failed = run({ type: 'opened' }, { type: 'pointPicked', point }, { type: 'mapFailed' });
    expect(failed.picker).toEqual({ status: 'open', candidate: null, map: 'failed' });
    expect(confirmablePoint(failed)).toBeNull();
    expect(confirmablePoint(reduceLockerPicker(failed, { type: 'pointPicked', point }))).toBeNull();
    const closed = reduceLockerPicker(failed, { type: 'cancelled' });
    expect(closed).toEqual({ mapFailed: true, picker: { status: 'closed' } });
    expect(reduceLockerPicker(closed, { type: 'opened' })).toBe(closed);
  });

  it('keeps one picker open when it is asked to open twice', () => {
    const picked = run({ type: 'opened' }, { type: 'pointPicked', point });
    expect(reduceLockerPicker(picked, { type: 'opened' })).toBe(picked);
  });
});

describe('locker entry', () => {
  it('offers the map with the workspace token while the map works', () => {
    expect(lockerEntry(map, closedLockerPicker)).toEqual({ kind: 'map', token: 'public-map-token' });
    expect(lockerEntry(map, run({ type: 'opened' }, { type: 'mapFailed' }))).toEqual({ kind: 'map', token: 'public-map-token' });
  });

  it('falls back to the typed code with its reason', () => {
    expect(lockerEntry({ status: 'unavailable' }, closedLockerPicker)).toEqual({ kind: 'code', reason: 'no_map' });
    expect(lockerEntry({ status: 'withheld_for_staff' }, closedLockerPicker)).toEqual({ kind: 'code', reason: 'withheld_for_staff' });
    expect(lockerEntry(map, run({ type: 'opened' }, { type: 'mapFailed' }, { type: 'cancelled' }))).toEqual({ kind: 'code', reason: 'map_failed' });
  });
});
