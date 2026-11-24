import type { InpostPoint, PickupPointLookup } from '#core/domain/index.js';

import type { PickupPointDirectory } from '../pickup-point-ports.js';

export const TEST_PICKUP_POINTS = {
  operating: 'WAW01M',
  notFound: 'MISSING1',
  notOperating: 'CLOSED01',
  unknownStatus: 'BUSY01',
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
  [TEST_PICKUP_POINTS.notOperating]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.notOperating, status: 'NonOperating' }) },
  [TEST_PICKUP_POINTS.unknownStatus]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.unknownStatus, status: 'Overloaded' }) },
  [TEST_PICKUP_POINTS.wrongType]: { kind: 'found', point: locker({ name: TEST_PICKUP_POINTS.wrongType, types: ['pop'], functions: ['parcel_send'] }) },
  [TEST_PICKUP_POINTS.unavailable]: { kind: 'unavailable' },
};

export const createPickupPointDirectoryFake = (): PickupPointDirectory & { lookups: string[] } => {
  const lookups: string[] = [];
  return {
    lookups,
    lookup: async (code) => {
      lookups.push(code);
      return answers[code] ?? { kind: 'not_found' };
    },
  };
};
