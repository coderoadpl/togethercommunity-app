import { relativeLuminance } from '#core/domain/index.js';
import { mix, nudgeToward, toHex } from './theme-branding.js';

const NON_TEXT_CONTRAST = 3;
const STEP = 0.12;

export interface ProgressTokens {
  track: string;
  border: string;
  fill: string;
}

/**
 * An empty track drawn in the divider color vanishes on dark surfaces, which
 * makes 0% and 100% read the same; the track is lifted off the surface and both
 * its outline and its fill are pushed until they clear the 3:1 non-text floor.
 */
export const progressTokens = (surface: string, accent: string): ProgressTokens => {
  const base = toHex(surface);
  const away = relativeLuminance(base) < 0.5 ? '#ffffff' : '#000000';
  const track = mix(base, away, STEP);
  return {
    track,
    border: nudgeToward(mix(track, away, STEP), away, base, NON_TEXT_CONTRAST),
    fill: nudgeToward(toHex(accent), away, track, NON_TEXT_CONTRAST),
  };
};
