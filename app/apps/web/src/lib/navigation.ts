/**
 * Entering and leaving the member view swaps the impersonation cookie, and only
 * a full document load hands the new cookie to the next surface with an empty
 * query cache; the router would keep both.
 */
export const navigateFresh = (url: string): void => {
  window.location.assign(url);
};
