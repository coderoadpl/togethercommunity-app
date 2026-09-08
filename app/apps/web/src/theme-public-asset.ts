export const publicAssetUrl = (path: string): string => {
  const base = import.meta.env.BASE_URL;
  const asset = path.replace(/^\//, '');
  return base.startsWith('/') ? `${base}${asset}` : new URL(`${base}${asset}`, document.baseURI).toString();
};
