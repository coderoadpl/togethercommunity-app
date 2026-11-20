import type { PickedPickupPoint } from './events.js';
import type { GeowidgetAccess } from './checkout-state.js';

export type LockerPickerState = {
  mapFailed: boolean;
  picker: { status: 'closed' } | { status: 'open'; candidate: PickedPickupPoint | null; map: 'shown' | 'failed' };
};

export type LockerPickerEvent =
  | { type: 'opened' }
  | { type: 'pointPicked'; point: PickedPickupPoint }
  | { type: 'mapFailed' }
  | { type: 'confirmed' }
  | { type: 'cancelled' };

export const closedLockerPicker: LockerPickerState = { mapFailed: false, picker: { status: 'closed' } };

export const reduceLockerPicker = (state: LockerPickerState, event: LockerPickerEvent): LockerPickerState => {
  switch (event.type) {
    case 'opened':
      return state.picker.status === 'open' || state.mapFailed ? state : { ...state, picker: { status: 'open', candidate: null, map: 'shown' } };
    case 'pointPicked':
      return state.picker.status === 'open' && state.picker.map === 'shown' ? { ...state, picker: { ...state.picker, candidate: event.point } } : state;
    case 'mapFailed':
      return state.picker.status === 'open' ? { mapFailed: true, picker: { status: 'open', candidate: null, map: 'failed' } } : { ...state, mapFailed: true };
    case 'confirmed':
    case 'cancelled':
      return state.picker.status === 'closed' ? state : { ...state, picker: { status: 'closed' } };
  }
};

export const confirmablePoint = (state: LockerPickerState): PickedPickupPoint | null =>
  state.picker.status === 'open' && state.picker.map === 'shown' ? state.picker.candidate : null;

export type LockerEntry =
  | { kind: 'map'; token: string }
  | { kind: 'code'; reason: 'no_map' | 'withheld_for_staff' | 'map_failed' };

export const lockerEntry = (geowidget: GeowidgetAccess, state: LockerPickerState): LockerEntry => {
  if (geowidget.status === 'withheld_for_staff') return { kind: 'code', reason: 'withheld_for_staff' };
  if (geowidget.status === 'unavailable') return { kind: 'code', reason: 'no_map' };
  return state.mapFailed && state.picker.status === 'closed' ? { kind: 'code', reason: 'map_failed' } : { kind: 'map', token: geowidget.token };
};
