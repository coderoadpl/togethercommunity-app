import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const NO_INSET = '0px';

interface BottomInsetValue {
  inset: string;
  setInset: (inset: string) => void;
}

const BottomInsetContext = createContext<BottomInsetValue>({
  inset: NO_INSET,
  setInset: () => undefined,
});

export const useBottomInset = (): string => useContext(BottomInsetContext).inset;

export const useReserveBottomInset = (height: string): void => {
  const { setInset } = useContext(BottomInsetContext);
  useEffect(() => {
    setInset(height);
    return () => setInset(NO_INSET);
  }, [setInset, height]);
};

export const BottomInsetProvider = ({ children }: { children: ReactNode }) => {
  const [inset, setInset] = useState(NO_INSET);
  const value = useMemo(() => ({ inset, setInset }), [inset]);
  return <BottomInsetContext value={value}>{children}</BottomInsetContext>;
};
