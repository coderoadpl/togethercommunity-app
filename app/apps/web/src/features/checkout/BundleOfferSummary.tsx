import { Stack, Typography } from '@mui/material';
import { PostContent } from '../../components/ui/PostContent.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle } from '../../theme.js';
import { OfferLines, type OfferLine } from '../../components/ui/OfferLines.js';
import type { ReactNode } from 'react';

export const BundleOfferSummary = <L extends OfferLine>({ heading, descriptionHtml, lines, currency, totalCents, afterName }: {
  heading: string;
  descriptionHtml: string;
  lines: readonly L[];
  afterName?: ((line: L) => ReactNode) | undefined;
  currency: string;
  totalCents: number;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing={2} data-testid="bundle-offer-summary">
    <CardTitle variant="h1">{heading}</CardTitle>
    <PostContent html={descriptionHtml} format="markdown" />
    <OfferLines lines={lines} currency={currency} afterName={afterName} />
    <Typography variant="h3">{t.salesLinks.total}: {formatPrice(totalCents, currency, language)}</Typography>
  </Stack>;
};
