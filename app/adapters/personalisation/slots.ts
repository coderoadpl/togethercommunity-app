import type { PersonalisationSlots } from '#core/server/index.js';

export const createPersonalisationSlots = (): PersonalisationSlots => {
  let active = 0;
  return {
    acquire: () => {
      if (active >= 2) return null;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    },
  };
};
