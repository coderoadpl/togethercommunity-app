import { Stack, Typography } from '@mui/material';
import { PostContent } from '../../components/ui/PostContent.js';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle } from '../../theme.js';
import { OfferLines } from '../../components/ui/OfferLines.js';
import type { ComponentProps } from 'react';

export const BundleOfferSummary = ({ heading, descriptionHtml, lines, currency, totalCents }: {
  heading: string;
  descriptionHtml: string;
  lines: ComponentProps<typeof OfferLines>['lines'];
  currency: string;
  totalCents: number;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing={2} data-testid="bundle-offer-summary">
    <CardTitle variant="h1">{heading}</CardTitle>
    <PostContent html={descriptionHtml} format="markdown" />
    <OfferLines lines={lines} currency={currency} />
    <Typography variant="h3">{t.salesLinks.total}: {formatPrice(totalCents, currency, language)}</Typography>
  </Stack>;
};
