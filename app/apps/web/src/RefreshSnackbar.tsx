import { useSyncExternalStore } from 'react';
import { Snackbar } from '@mui/material';

import { useTranslations } from './i18n/index.js';
import { refreshToastStore } from './refresh-toast.js';

/** Renders the QueryCache refresh-failure notice while stale data stays on screen. */
export const RefreshSnackbar = () => {
  const t = useTranslations();
  const toast = useSyncExternalStore(refreshToastStore.subscribe, refreshToastStore.snapshot);

  return (
    <Snackbar
      open={toast !== null}
      autoHideDuration={6000}
      onClose={() => refreshToastStore.dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      message={toast === null ? '' : t.refresh.failed({ message: toast.message })}
    />
  );
};
