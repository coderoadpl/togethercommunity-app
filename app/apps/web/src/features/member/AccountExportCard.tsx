import { Box, Button } from '@mui/material';
import { AccountCard as SectionCard } from './AccountCard.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

export const AccountExportCard = ({ pending, error, onDownload }: { pending: boolean; error: Error | null; onDownload(): void }) => {
  const t = useTranslations();
  return (
          <Box><SectionCard
            title={t.account.dataExportHeading}
            description={t.account.dataExportIntro}
          >
            <Box>
              <Button
                variant="outlined"
                data-testid="account-data-export"
                disabled={pending}
                onClick={onDownload}
              >
                {pending ? t.account.dataExportPreparing : t.account.dataExportButton}
              </Button>
            </Box>
            {error !== null ? (
              <StatusView
                state={{ kind: 'error', message: localizeError(error, t), retry: { label: t.common.retry, onRetry: onDownload } }}
              />
            ) : null}
          </SectionCard></Box>
  );
};
