export const orderVerificationUrl = (workspaceOrigin: string, token: string): string => {
  const url = new URL(`/panel/orders/verify/${encodeURIComponent(token)}`, workspaceOrigin);
  url.protocol = 'https:';
  return url.toString();
};
