import { expect, it } from 'vitest';

import { createPersonalisationSlots } from './slots.js';

it('bounds each instance independently and releases each reservation only once', () => {
  const slots = createPersonalisationSlots();
  const first = slots.acquire();
  const second = slots.acquire();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(slots.acquire()).toBeNull();
  expect(createPersonalisationSlots().acquire()).not.toBeNull();
  first?.();
  first?.();
  expect(slots.acquire()).not.toBeNull();
  expect(slots.acquire()).toBeNull();
  second?.();
  expect(slots.acquire()).not.toBeNull();
  expect(slots.acquire()).toBeNull();
});
