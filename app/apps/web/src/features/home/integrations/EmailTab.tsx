import { SectionCard } from '../../../components/layout/index.js';
import { useTranslations } from '../../../i18n/index.js';
import { ProviderTest } from './ProviderTest.js';

export const EmailTab = () => {
  const t = useTranslations();

  return (
    <SectionCard title={t.integrations.emailHeading} description={t.integrations.emailDescription}>
      <ProviderTest provider="email" ready />
    </SectionCard>
  );
};
