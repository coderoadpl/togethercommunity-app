import type { GeowidgetAccess } from './checkout-state.js';

export type LockerPickerState = {
  mapFailed: boolean;
  picker: { status: 'closed' } | { status: 'open'; map: 'shown' | 'failed' };
};

export type LockerPickerEvent =
  | { type: 'opened' }
  | { type: 'pointPicked' }
  | { type: 'mapFailed' }
  | { type: 'cancelled' };

export const closedLockerPicker: LockerPickerState = { mapFailed: false, picker: { status: 'closed' } };

export const acceptsPoint = (state: LockerPickerState): boolean => state.picker.status === 'open' && state.picker.map === 'shown';

export const reduceLockerPicker = (state: LockerPickerState, event: LockerPickerEvent): LockerPickerState => {
  switch (event.type) {
    case 'opened':
      return state.picker.status === 'open' || state.mapFailed ? state : { ...state, picker: { status: 'open', map: 'shown' } };
    case 'pointPicked':
      return acceptsPoint(state) ? { ...state, picker: { status: 'closed' } } : state;
    case 'mapFailed':
      return state.picker.status === 'open' ? { mapFailed: true, picker: { status: 'open', map: 'failed' } } : { ...state, mapFailed: true };
    case 'cancelled':
      return state.picker.status === 'closed' ? state : { ...state, picker: { status: 'closed' } };
  }
};

export type LockerEntry =
  | { kind: 'map'; token: string }
  | { kind: 'code'; reason: 'no_map' | 'withheld_for_staff' | 'map_failed' };

export const lockerEntry = (geowidget: GeowidgetAccess, state: LockerPickerState): LockerEntry => {
  if (geowidget.status === 'withheld_for_staff') return { kind: 'code', reason: 'withheld_for_staff' };
  if (geowidget.status === 'unavailable') return { kind: 'code', reason: 'no_map' };
  return state.mapFailed && state.picker.status === 'closed' ? { kind: 'code', reason: 'map_failed' } : { kind: 'map', token: geowidget.token };
};
