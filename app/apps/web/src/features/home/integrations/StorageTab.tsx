import { useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { ProviderTest } from './ProviderTest.js';
import { StorageWizard } from './StorageWizard.js';
import { previewFor } from './secret-preview.js';

export const StorageTab = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);

  const storageReady =
    secrets.data?.secrets !== undefined &&
    previewFor(secrets.data.secrets, 's3.configuration') !== null;

  return (
    <SectionCard title={t.integrations.s3Heading} description={t.integrations.s3Description}>
      {secrets.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
      ) : secrets.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
      ) : (
        <StorageWizard configured={storageReady} />
      )}
      <ProviderTest
        provider="storage"
        ready={storageReady}
        hint={t.integrations.s3SaveFirst}
        showHint={!secrets.isPending && !secrets.isError}
      />
    </SectionCard>
  );
};
