/** Chrome's "block all site data" makes the `sessionStorage` getter itself throw. */
export const denySiteData = (): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('site data blocked');
    },
  });
  return () => {
    if (descriptor === undefined) Reflect.deleteProperty(window, 'sessionStorage');
    else Object.defineProperty(window, 'sessionStorage', descriptor);
  };
};
