export type CoalescedRunner = () => void;

/**
 * Collapses a burst of triggers into one in-flight run plus at most one follow-up,
 * so N enqueues never start N overlapping dispatch passes.
 */
export const createCoalescedRunner = (run: () => Promise<void>): CoalescedRunner => {
  let inFlight: Promise<void> | null = null;
  let followUp = false;

  const loop = async (): Promise<void> => {
    try {
      do {
        followUp = false;
        await run();
      } while (followUp);
    } finally {
      inFlight = null;
    }
  };

  return () => {
    followUp = true;
    if (inFlight !== null) return;
    inFlight = loop().catch(() => undefined);
  };
};
