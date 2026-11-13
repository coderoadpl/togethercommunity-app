import { useQuery } from '@tanstack/react-query';
import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { SecretField } from '../integrations/SecretField.js';

export const MetaCapiTokenSettings = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const configured = secrets.data?.secrets.some((secret) => secret.key === 'analyticsMetaCapiAccessToken') === true;
  return (
    <SectionCard title={t.metaCapi.token} description={t.metaCapi.tokenHelp}>
      {secrets.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : secrets.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
      ) : (
        <SecretField secretKey="analyticsMetaCapiAccessToken" label={t.metaCapi.token} maskedPreview={configured ? t.integrations.configured : null} />
      )}
    </SectionCard>
  );
};
