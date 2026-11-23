import type { InpostPoint, PickupPointLookup } from '#core/domain/index.js';

import type { PickupPointDirectory } from '../pickup-point-ports.js';

export const TEST_PICKUP_POINTS = {
  operating: 'WAW01M',
  operatingNorth: 'WAW02M',
  operatingSouth: 'WAW03M',
  notFound: 'MISSING1',
  notOperating: 'CLOSED01',
  wrongType: 'SENDONLY1',
  unavailable: 'OUTAGE01',
} as const;

const locker = (change: Partial<InpostPoint> = {}): InpostPoint => ({
  name: TEST_PICKUP_POINTS.operating,
  status: 'Operating',
  types: ['parcel_locker'],
  functions: ['parcel_collect', 'parcel_send'],
  locationDescription: 'Next to the main entrance',
  address: { line1: 'Main Street 1', line2: '00-001 Warsaw' },
  ...change,
});

const answers: Readonly<Record<string, PickupPointLookup>> = {
  [TEST_PICKUP_POINTS.operating]: { kind: 'found', point: locker() },
  [TEST_PICKUP_POINTS.operatingNorth]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.operatingNorth, locationDescription: 'By the north gate', address: { line1: 'North Street 2', line2: '00-002 Warsaw' } }) },
  [TEST_PICKUP_POINTS.operatingSouth]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.operatingSouth, locationDescription: null, address: { line1: 'South Street 3', line2: null } }) },
  [TEST_PICKUP_POINTS.notOperating]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.notOperating, status: 'NonOperating' }) },
  [TEST_PICKUP_POINTS.wrongType]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.wrongType, types: ['pop'], functions: ['parcel_send'] }) },
  [TEST_PICKUP_POINTS.unavailable]: { kind: 'unavailable' },
};

export const testPickupPointAnswer = (code: string): PickupPointLookup => answers[code] ?? { kind: 'not_found' };

export const createPickupPointDirectoryFake = (): PickupPointDirectory & { lookups: string[] } => {
  const lookups: string[] = [];
  return {
    lookups,
    lookup: async (code) => {
      lookups.push(code);
      return testPickupPointAnswer(code);
    },
  };
};
