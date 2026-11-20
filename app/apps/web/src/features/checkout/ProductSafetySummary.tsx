import { Box, Link, Stack, Typography } from '@mui/material';
import { Fragment, useId, useState, type ReactNode } from 'react';

import type { PublicProductCompliance } from '#core/domain/index.js';

import { ChevronDownIcon } from '../../components/ui/account-icons.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { useTranslations } from '../../i18n/index.js';
import { CheckoutInlineToggle, CheckoutSafetyHeading, CheckoutSafetyLastPart, CheckoutSafetyPart, CheckoutSafetySection, CheckoutSafetySeparator, CheckoutSafetyWarnings } from '../../theme.js';

type SafetyEntry = { productId: string; title: string; compliance: PublicProductCompliance };

type SafetyGroup = {
  key: string;
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  entries: SafetyEntry[];
};

const groupSafetyEntries = (entries: readonly SafetyEntry[]): SafetyGroup[] => {
  const groups = new Map<string, SafetyGroup>();
  for (const entry of entries) {
    const { manufacturerName, manufacturerAddress, manufacturerEmail } = entry.compliance;
    const key = JSON.stringify([manufacturerName.trim(), manufacturerAddress.trim(), manufacturerEmail.trim().toLowerCase()]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, manufacturerName, manufacturerAddress, manufacturerEmail, entries: [entry] });
    else group.entries.push(entry);
  }
  return [...groups.values()];
};

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <Typography variant="body2">
    <Box component="span" color="text.secondary">{label}: </Box>
    {children}
  </Typography>
);

const ProductDetails = ({ entry, titled }: { entry: SafetyEntry; titled: boolean }) => {
  const t = useTranslations();
  const { compliance } = entry;
  return (
    <Stack useFlexGap spacing="0.35rem" data-testid={`product-safety-product-${entry.productId}`}>
      {titled ? <Typography variant="subtitle2" color="text.primary">{entry.title}</Typography> : null}
      <Detail label={t.productSafety.model}>{compliance.modelIdentifier}</Detail>
      {compliance.batchIdentifier == null ? null : <Detail label={t.productSafety.batch}>{compliance.batchIdentifier}</Detail>}
      {compliance.safetyWarningsHtml.trim() === '' ? null : (
        <CheckoutSafetyWarnings>
          <RichTextContent html={compliance.safetyWarningsHtml} data-testid="product-safety-warnings" />
        </CheckoutSafetyWarnings>
      )}
      {compliance.instructionsUrl == null ? null : (
        <Link href={compliance.instructionsUrl} target="_blank" rel="noopener noreferrer" variant="body2">{t.productSafety.instructions}</Link>
      )}
    </Stack>
  );
};

const ManufacturerLine = ({ group, countProducts, titled, emphasised }: { group: SafetyGroup; countProducts: boolean; titled: boolean; emphasised: boolean }) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const parts = [
    <CheckoutSafetyPart key="name" emphasised={emphasised}>{group.manufacturerName}</CheckoutSafetyPart>,
    <CheckoutSafetyPart key="address">{group.manufacturerAddress}</CheckoutSafetyPart>,
    <CheckoutSafetyPart key="email"><Link href={`mailto:${group.manufacturerEmail}`} color="inherit">{group.manufacturerEmail}</Link></CheckoutSafetyPart>,
    ...(countProducts ? [<CheckoutSafetyPart key="count">{t.productSafety.appliesTo({ count: group.entries.length })}</CheckoutSafetyPart>] : []),
  ];
  return (
    <Box data-testid="product-safety-manufacturer">
      <Typography variant="body2" color="text.secondary">
        {parts.slice(0, -1).map((part) => <Fragment key={part.key}>{part}<CheckoutSafetySeparator>{' · '}</CheckoutSafetySeparator></Fragment>)}
        <CheckoutSafetyLastPart>
          {parts.at(-1)}
          <CheckoutInlineToggle
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t.productSafety.detailsFor({ name: group.manufacturerName })}
            onClick={() => setOpen((current) => !current)}
            sx={{ minHeight: { xs: '2.75rem', sm: '1.75rem' } }}
          >
            {t.productSafety.details}
            <ChevronDownIcon />
          </CheckoutInlineToggle>
        </CheckoutSafetyLastPart>
      </Typography>
      <Box id={panelId} hidden={!open} sx={{ pt: '0.5rem', pb: '0.25rem' }}>
        <Stack useFlexGap spacing="0.75rem">
          {group.entries.map((entry) => <ProductDetails key={entry.productId} entry={entry} titled={titled} />)}
        </Stack>
      </Box>
    </Box>
  );
};

export const ProductSafetySummary = ({ entries, multiProduct }: { entries: readonly SafetyEntry[]; multiProduct: boolean }) => {
  const t = useTranslations();
  const headingId = useId();
  if (entries.length === 0) return null;
  const groups = groupSafetyEntries(entries);
  return (
    <CheckoutSafetySection aria-labelledby={headingId} data-testid="product-safety-info">
      <CheckoutSafetyHeading id={headingId} component="h2">{t.productSafety.offerHeading}</CheckoutSafetyHeading>
      <Stack useFlexGap spacing={groups.length > 1 ? '0.75rem' : '0.35rem'} sx={{ mt: '0.25rem' }}>
        {groups.map((group) => (
          <ManufacturerLine key={group.key} group={group} countProducts={multiProduct} titled={multiProduct} emphasised={groups.length > 1} />
        ))}
      </Stack>
    </CheckoutSafetySection>
  );
};
