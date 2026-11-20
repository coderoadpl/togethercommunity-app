import { Box, Link, Stack, Typography } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';

import type { PublicProductCompliance } from '#core/domain/index.js';

import { ChevronDownIcon } from '../../components/ui/account-icons.js';
import { closesOnEscape } from '../../components/ui/CheckoutStepParts.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { useTranslations } from '../../i18n/index.js';
import { CheckoutInlineToggle, CheckoutSafetyHeading, CheckoutSafetyPart, CheckoutSafetyProduct, CheckoutSafetySection, CheckoutSafetyThumbnail, CheckoutSafetyThumbnailSlot, CheckoutSafetyWarnings } from '../../theme.js';

type SafetyEntry = { productId: string; title: string; coverUrl: string | null; compliance: PublicProductCompliance };

type SafetyGroup = {
  key: string;
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  entries: SafetyEntry[];
};

const LONG_WARNING_CHARACTERS = 280;

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

const hasExtras = ({ compliance }: SafetyEntry): boolean => compliance.batchIdentifier != null || compliance.instructionsUrl != null;

const compactToggleHeight = { minHeight: { xs: '2.75rem', sm: '1.75rem' } };

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <Typography variant="body2">
    <Box component="span" color="text.secondary">{label}: </Box>
    {children}
  </Typography>
);

const ProductPicture = ({ src, alt, keepSlot }: { src: string | null | undefined; alt: string; keepSlot: boolean }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src == null || failedSrc === src) return keepSlot ? <CheckoutSafetyThumbnailSlot aria-hidden="true" data-testid="product-safety-picture-slot" /> : null;
  return <CheckoutSafetyThumbnail src={src} alt={alt} width={40} height={40} loading="lazy" onError={() => setFailedSrc(src)} data-testid="product-safety-picture" />;
};

const SafetyWarning = ({ compliance }: { compliance: PublicProductCompliance }) => {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  const warningId = useId();
  if (compliance.safetyWarningsHtml.trim() === '') return null;
  const long = compliance.safetyWarnings.length > LONG_WARNING_CHARACTERS;
  return (
    <Box {...closesOnEscape}>
      <CheckoutSafetyWarnings id={warningId} clamped={long && !expanded}>
        <RichTextContent html={compliance.safetyWarningsHtml} data-testid="product-safety-warnings" />
      </CheckoutSafetyWarnings>
      {long ? (
        <CheckoutInlineToggle type="button" aria-expanded={expanded} aria-controls={warningId} onClick={() => setExpanded((current) => !current)} sx={compactToggleHeight}>
          {expanded ? t.productSafety.showLess : t.productSafety.showMore}
        </CheckoutInlineToggle>
      ) : null}
    </Box>
  );
};

const ProductIdentity = ({ entry, titled, pictured }: { entry: SafetyEntry; titled: boolean; pictured: boolean }) => {
  const t = useTranslations();
  return (
    <CheckoutSafetyProduct data-testid={`product-safety-product-${entry.productId}`}>
      <ProductPicture src={entry.coverUrl} alt={entry.title} keepSlot={pictured} />
      <Stack useFlexGap spacing="0.2rem" sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {titled ? <><Box component="span" color="text.primary">{entry.title}</Box>{' · '}</> : null}
          <span>{t.productSafety.model}: </span>
          <span>{entry.compliance.modelIdentifier}</span>
        </Typography>
        <SafetyWarning compliance={entry.compliance} />
      </Stack>
    </CheckoutSafetyProduct>
  );
};

const ProductExtras = ({ entry, titled }: { entry: SafetyEntry; titled: boolean }) => {
  const t = useTranslations();
  const { compliance } = entry;
  return (
    <Stack useFlexGap spacing="0.35rem" data-testid={`product-safety-details-${entry.productId}`}>
      {titled ? <Typography variant="subtitle2" color="text.primary">{entry.title}</Typography> : null}
      {compliance.batchIdentifier == null ? null : <Detail label={t.productSafety.batch}>{compliance.batchIdentifier}</Detail>}
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
  const extras = group.entries.filter(hasExtras);
  const pictured = group.entries.some((entry) => entry.coverUrl != null);
  return (
    <Box data-testid="product-safety-manufacturer" {...closesOnEscape}>
      <Typography variant="body2" color="text.secondary">
        <CheckoutSafetyPart emphasised={emphasised}>{group.manufacturerName}</CheckoutSafetyPart>
        <CheckoutSafetyPart>{group.manufacturerAddress}</CheckoutSafetyPart>
        <CheckoutSafetyPart><Link href={`mailto:${group.manufacturerEmail}`} color="inherit">{group.manufacturerEmail}</Link></CheckoutSafetyPart>
        {countProducts ? <CheckoutSafetyPart>{t.productSafety.appliesTo({ count: group.entries.length })}</CheckoutSafetyPart> : null}
      </Typography>
      <Stack useFlexGap spacing="0.5rem" sx={{ pt: '0.375rem' }}>
        {group.entries.map((entry) => <ProductIdentity key={entry.productId} entry={entry} titled={titled} pictured={pictured} />)}
      </Stack>
      {extras.length === 0 ? null : (
        <>
          <CheckoutInlineToggle
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={t.productSafety.detailsFor({ name: group.manufacturerName })}
            onClick={() => setOpen((current) => !current)}
            sx={{ ...compactToggleHeight, mt: '0.25rem' }}
          >
            {t.productSafety.details}
            <ChevronDownIcon />
          </CheckoutInlineToggle>
          <Box id={panelId} hidden={!open} sx={{ pb: '0.25rem' }}>
            <Stack useFlexGap spacing="0.75rem">
              {extras.map((entry) => <ProductExtras key={entry.productId} entry={entry} titled={extras.length > 1} />)}
            </Stack>
          </Box>
        </>
      )}
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
