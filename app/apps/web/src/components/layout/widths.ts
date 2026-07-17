/**
 * The app-wide page-width scale (decision D3): every page skeleton picks one
 * of these tokens, so no other max-width values may appear outside this file.
 */
export const PAGE_WIDTH = {
  focusNarrow: '28rem',
  focusWide: '32rem',
  prose: '44rem',
  panel: '60rem',
  wide: '72rem',
} as const;

export type PageWidth = keyof typeof PAGE_WIDTH;
