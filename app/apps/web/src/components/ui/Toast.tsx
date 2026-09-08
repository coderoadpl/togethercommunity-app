import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Box, IconButton, Snackbar, Stack, SvgIcon, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';

type ToastKind = 'success' | 'error' | 'info';

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
}

const missingToastProvider = () => {
  throw new Error('useToast must be used inside ToastProvider');
};

const ToastContext = createContext<ToastApi>({
  success: missingToastProvider,
  error: missingToastProvider,
  info: missingToastProvider,
});

const AUTO_HIDE_MS: Record<ToastKind, number> = {
  success: 5000,
  error: 8000,
  info: 5000,
};

const TOAST_LIMIT = 3;

const hiddenLiveRegionSx = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
};

const CloseIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4l-6.3 6.31-1.42-1.42L9.17 12l-6.3-6.29 1.42-1.42 6.3 6.31 6.3-6.31z" />
  </SvgIcon>
);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const t = useTranslations();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [politeMessage, setPoliteMessage] = useState('');

  const dismiss = useCallback((id: number) => {
    const timeout = timers.current.get(id);
    if (timeout !== undefined) clearTimeout(timeout);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    nextId.current += 1;
    const id = nextId.current;
    const toast = { id, kind, message };
    const timeout = setTimeout(() => dismiss(id), AUTO_HIDE_MS[kind]);
    timers.current.set(id, timeout);
    if (kind !== 'error') setPoliteMessage(message);
    setToasts((current) => {
      const next = [...current, toast].slice(-TOAST_LIMIT);
      const active = new Set(next.map((entry) => entry.id));
      for (const [timerId, currentTimeout] of timers.current) {
        if (!active.has(timerId)) {
          clearTimeout(currentTimeout);
          timers.current.delete(timerId);
        }
      }
      return next;
    });
  }, [dismiss]);

  useEffect(() => () => {
    for (const timeout of timers.current.values()) clearTimeout(timeout);
    timers.current.clear();
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }), [push]);

  return (
    <ToastContext value={api}>
      {children}
      <Box role="status" aria-live="polite" sx={hiddenLiveRegionSx}>{politeMessage}</Box>
      <Snackbar
        open={toasts.length > 0}
        anchorOrigin={{ vertical: 'bottom', horizontal: mobile ? 'center' : 'right' }}
        transitionDuration={reducedMotion ? 0 : undefined}
        sx={{
          width: { xs: 'calc(100vw - 1rem)', sm: 'min(32rem, calc(100vw - 3rem))' },
          maxWidth: 'none',
        }}
      >
        <Stack useFlexGap spacing="0.75rem" sx={{ width: '100%' }} data-testid="toast-stack">
          {toasts.map((toast) => (
            <Alert
              key={toast.id}
              severity={toast.kind}
              role={toast.kind === 'error' ? 'alert' : undefined}
              action={(
                <IconButton
                  size="small"
                  color="inherit"
                  aria-label={`${t.common.close}: ${toast.message}`}
                  onClick={() => dismiss(toast.id)}
                  data-testid={`toast-dismiss-${String(toast.id)}`}
                >
                  <CloseIcon />
                </IconButton>
              )}
              data-testid={`toast-${toast.kind}-${String(toast.id)}`}
              sx={{ width: '100%' }}
            >
              {toast.message}
            </Alert>
          ))}
        </Stack>
      </Snackbar>
    </ToastContext>
  );
};

export const useToast = (): ToastApi => {
  return useContext(ToastContext);
};

export const useToastSuccess = (success: boolean, message: string | null) => {
  const toast = useToast();

  useEffect(() => {
    if (success && message !== null) toast.success(message);
  }, [success, message, toast]);
};

export const useToastError = (message: string | null) => {
  const toast = useToast();

  useEffect(() => {
    if (message !== null) toast.error(message);
  }, [message, toast]);
};

export const useToastOutcome = (
  success: boolean,
  successMessage: string | null,
  errorMessage: string | null,
) => {
  useToastSuccess(success, successMessage);
  useToastError(errorMessage);
};
