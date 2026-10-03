export const vercelPersonalisationMaxBytes = (configuredBytes: number): number =>
  Math.min(configuredBytes, 4 * 1024 * 1024);
