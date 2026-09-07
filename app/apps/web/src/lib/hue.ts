/** Same seed, same colour, forever — golden-angle spread keeps neighbours apart. */
export const deterministicHue = (seed: string): number => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return Math.round((hash * 137.508) % 360);
};
