import { SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { ImportApiKeys } from './ImportApiKeys.js';

export const ApiKeysTab = () => {
  const t = useTranslations();

  return (
    <SectionCard
      title={t.integrations.importKeysHeading}
      description={t.integrations.importKeysDescription}
    >
      <ImportApiKeys />
    </SectionCard>
  );
};
