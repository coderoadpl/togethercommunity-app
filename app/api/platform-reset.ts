/**
 * Own function file so the reseed gets the 300 s ceiling without raising it for
 * every other API route, which keeps sharing this handler.
 */
export const maxDuration = 300;

export { default } from '../apps/server/src/entry.vercel.js';
