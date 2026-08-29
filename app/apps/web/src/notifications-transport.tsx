import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface NotificationsTransportValue {
  streamless: boolean;
  reportStreamless: () => void;
  reportStreaming: () => void;
}

const NotificationsTransportContext = createContext<NotificationsTransportValue>({
  streamless: false,
  reportStreamless: () => undefined,
  reportStreaming: () => undefined,
});

export const useNotificationsTransport = (): NotificationsTransportValue =>
  useContext(NotificationsTransportContext);

export const NotificationsTransportProvider = ({ children }: { children: ReactNode }) => {
  const [streamless, setStreamless] = useState(false);
  const reportStreamless = useCallback(() => setStreamless(true), []);
  const reportStreaming = useCallback(() => setStreamless(false), []);
  const value = useMemo(
    () => ({ streamless, reportStreamless, reportStreaming }),
    [streamless, reportStreamless, reportStreaming],
  );
  return (
    <NotificationsTransportContext value={value}>{children}</NotificationsTransportContext>
  );
};
