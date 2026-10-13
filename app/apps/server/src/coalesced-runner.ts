export type CoalescedRunner = () => void;

export const createCoalescedRunner = (
  run: () => Promise<void>,
  keepAlive?: (task: Promise<unknown>) => void,
): CoalescedRunner => {
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
    keepAlive?.(inFlight);
  };
};
