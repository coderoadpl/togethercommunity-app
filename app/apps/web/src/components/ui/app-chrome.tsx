import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface AppChromeValue {
  chromeSuppressed: boolean;
  setChromeSuppressed: (suppressed: boolean) => void;
}

const AppChromeContext = createContext<AppChromeValue>({
  chromeSuppressed: false,
  setChromeSuppressed: () => undefined,
});

/** Read by the floating language/theme switchers so they yield to owned chrome. */
export const useGlobalChromeSuppressed = (): boolean => useContext(AppChromeContext).chromeSuppressed;

/**
 * Surfaces that host the switchers inside their own AppBar (the creator panel)
 * call this to hide the floating global switchers while mounted.
 */
export const useSuppressGlobalChrome = (): void => {
  const { setChromeSuppressed } = useContext(AppChromeContext);
  useEffect(() => {
    setChromeSuppressed(true);
    return () => setChromeSuppressed(false);
  }, [setChromeSuppressed]);
};

export const AppChromeProvider = ({ children }: { children: ReactNode }) => {
  const [chromeSuppressed, setChromeSuppressed] = useState(false);
  const value = useMemo(
    () => ({ chromeSuppressed, setChromeSuppressed }),
    [chromeSuppressed],
  );
  return <AppChromeContext value={value}>{children}</AppChromeContext>;
};
