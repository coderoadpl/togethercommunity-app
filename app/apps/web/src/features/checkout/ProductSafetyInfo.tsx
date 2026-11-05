import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Link, Stack, Typography } from '@mui/material';
import { useId, type ReactNode } from 'react';

import { attributionFromSearchParams, attributionToSearchParams, type PublicProductCompliance, type PublicProductVariant } from '#core/domain/index.js';

import { ChevronDownIcon } from '../../components/ui/account-icons.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { useTranslations } from '../../i18n/index.js';

const Detail = ({ label, children }: { label: string; children: ReactNode }) => (
  <Typography variant="body2">
    <Box component="span" color="text.secondary">{label}: </Box>
    {children}
  </Typography>
);

const SafetyDetails = ({ compliance }: { compliance: PublicProductCompliance }) => {
  const t = useTranslations();
  return (
    <Stack useFlexGap spacing="0.5rem">
      <Detail label={t.productSafety.manufacturer}>{compliance.manufacturerName}, {compliance.manufacturerAddress}</Detail>
      <Detail label={t.productSafety.contact}>
        <Link href={`mailto:${compliance.manufacturerEmail}`}>{compliance.manufacturerEmail}</Link>
      </Detail>
      <Detail label={t.productSafety.model}>{compliance.modelIdentifier}</Detail>
      {compliance.batchIdentifier == null ? null : <Detail label={t.productSafety.batch}>{compliance.batchIdentifier}</Detail>}
      {compliance.safetyWarningsHtml.trim() === '' ? null : <RichTextContent html={compliance.safetyWarningsHtml} data-testid="product-safety-warnings" />}
      {compliance.instructionsUrl == null ? null : (
        <Link href={compliance.instructionsUrl} target="_blank" rel="noopener noreferrer">{t.productSafety.instructions}</Link>
      )}
    </Stack>
  );
};

export const ProductSafetyInfo = ({ compliance, expanded, productTitle }: { compliance: PublicProductCompliance; expanded: boolean; productTitle?: string | undefined }) => {
  const t = useTranslations();
  const headingId = useId();
  const heading = productTitle === undefined ? t.productSafety.offerHeading : t.productSafety.offerHeadingFor({ title: productTitle });
  if (expanded) {
    return (
      <Stack component="section" useFlexGap spacing="0.5rem" aria-labelledby={headingId} data-testid="product-safety-info">
        <Typography id={headingId} component="h2" variant="h3">{heading}</Typography>
        <SafetyDetails compliance={compliance} />
      </Stack>
    );
  }
  return (
    <Accordion disableGutters elevation={0} data-testid="product-safety-info">
      <AccordionSummary expandIcon={<ChevronDownIcon />} sx={{ px: 0 }}>
        <Typography component="h2" variant="h3">{heading}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0 }}>
        <SafetyDetails compliance={compliance} />
      </AccordionDetails>
    </Accordion>
  );
};

export const ProductVariantChips = ({ productId, variants }: { productId: string; variants: PublicProductVariant[] }) => {
  const t = useTranslations();
  if (variants.length < 2) return null;
  const attribution = attributionToSearchParams(attributionFromSearchParams(new URLSearchParams(window.location.search))).toString();
  return (
    <Stack component="nav" direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }} aria-label={t.productVariants.offerLabel} data-testid="product-variants">
      {variants.map((variant) => {
        const current = variant.productId === productId;
        const label = variant.soldOut ? `${variant.label} · ${t.productVariants.soldOut}` : variant.label;
        return current || variant.soldOut ? (
          <Chip
            key={variant.productId}
            label={label}
            color={current ? 'primary' : 'default'}
            variant={current ? 'filled' : 'outlined'}
            disabled={variant.soldOut && !current}
            {...(current ? { 'aria-current': 'page' as const } : {})}
            data-testid={`product-variant-${variant.productId}`}
          />
        ) : (
          <Chip
            key={variant.productId}
            label={label}
            variant="outlined"
            component="a"
            href={`/checkout/${encodeURIComponent(variant.slug)}${attribution === '' ? '' : `?${attribution}`}`}
            clickable
            data-testid={`product-variant-${variant.productId}`}
          />
        );
      })}
    </Stack>
  );
};
