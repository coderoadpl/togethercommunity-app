import { describe, expect, it } from 'vitest';

import type { LockerPickerEvent } from './events.js';
import { acceptsPoint, closedLockerPicker, lockerEntry, reduceLockerPicker, type LockerPickerState } from './locker-picker.js';

const run = (...events: LockerPickerEvent[]): LockerPickerState => events.reduce(reduceLockerPicker, closedLockerPicker);
const map = { status: 'map', token: 'public-map-token' } as const;

describe('locker picker state', () => {
  it('opens with the map shown and accepts a point from it', () => {
    const opened = run({ type: 'pickerOpened' });
    expect(opened.picker).toEqual({ status: 'open', map: 'shown' });
    expect(acceptsPoint(opened)).toBe(true);
  });

  it('closes as soon as the map reports a point, so there is no second step', () => {
    const picked = run({ type: 'pickerOpened' }, { type: 'pointSelected' });
    expect(picked).toEqual(closedLockerPicker);
    expect(acceptsPoint(picked)).toBe(false);
  });

  it('closes on cancel', () => {
    expect(run({ type: 'pickerOpened' }, { type: 'pickerCancelled' })).toEqual(closedLockerPicker);
  });

  it('ignores points that arrive while the picker is closed', () => {
    expect(acceptsPoint(closedLockerPicker)).toBe(false);
    expect(run({ type: 'pointSelected' })).toEqual(closedLockerPicker);
    expect(run({ type: 'pickerOpened' }, { type: 'pointSelected' }, { type: 'pointSelected' })).toEqual(closedLockerPicker);
  });

  it('shows the failure inside the open picker, accepts no point and remembers it after closing', () => {
    const failed = run({ type: 'pickerOpened' }, { type: 'mapFailed' });
    expect(failed.picker).toEqual({ status: 'open', map: 'failed' });
    expect(acceptsPoint(failed)).toBe(false);
    expect(reduceLockerPicker(failed, { type: 'pointSelected' })).toBe(failed);
    const closed = reduceLockerPicker(failed, { type: 'pickerCancelled' });
    expect(closed).toEqual({ mapFailed: true, picker: { status: 'closed' } });
    expect(reduceLockerPicker(closed, { type: 'pickerOpened' })).toBe(closed);
  });

  it('shows the map again when the buyer asks to retry a failure inside the open picker', () => {
    const retried = run({ type: 'pickerOpened' }, { type: 'mapFailed' }, { type: 'mapRetryRequested' });
    expect(retried).toEqual({ mapFailed: false, picker: { status: 'open', map: 'shown' } });
    expect(acceptsPoint(retried)).toBe(true);
    expect(lockerEntry(map, reduceLockerPicker(retried, { type: 'pickerCancelled' }))).toEqual({ kind: 'map', token: 'public-map-token' });
  });

  it('ignores a retry while the map is shown or the picker is closed, so a failure left behind keeps the typed code', () => {
    const opened = run({ type: 'pickerOpened' });
    expect(reduceLockerPicker(opened, { type: 'mapRetryRequested' })).toBe(opened);
    const left = run({ type: 'pickerOpened' }, { type: 'mapFailed' }, { type: 'pickerCancelled' });
    expect(reduceLockerPicker(left, { type: 'mapRetryRequested' })).toBe(left);
  });

  it('keeps one picker open when it is asked to open twice', () => {
    const opened = run({ type: 'pickerOpened' });
    expect(reduceLockerPicker(opened, { type: 'pickerOpened' })).toBe(opened);
  });
});

describe('locker entry', () => {
  it('offers the map with the workspace token while the map works', () => {
    expect(lockerEntry(map, closedLockerPicker)).toEqual({ kind: 'map', token: 'public-map-token' });
    expect(lockerEntry(map, run({ type: 'pickerOpened' }, { type: 'mapFailed' }))).toEqual({ kind: 'map', token: 'public-map-token' });
  });

  it('falls back to the typed code with its reason', () => {
    expect(lockerEntry({ status: 'unavailable' }, closedLockerPicker)).toEqual({ kind: 'code', reason: 'no_map' });
    expect(lockerEntry({ status: 'withheld_for_staff' }, closedLockerPicker)).toEqual({ kind: 'code', reason: 'withheld_for_staff' });
    expect(lockerEntry(map, run({ type: 'pickerOpened' }, { type: 'mapFailed' }, { type: 'pickerCancelled' }))).toEqual({ kind: 'code', reason: 'map_failed' });
  });
});
