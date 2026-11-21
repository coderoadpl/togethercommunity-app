import type { ReactNode } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';

export type OfferLine = { productId: string; name: string; grossCents: number; netCents: number; vatRate: number | 'exempt' | null; vatCents: number; vatExemptionBasis: string | null };

type BuyerLineDetails = {
  type?: 'course' | 'digital_download' | 'membership' | 'physical';
  deliveryMethod?: 'pickup' | 'shipping';
};

const TAX_LIST_SX = {
  display: 'flex', flexWrap: 'wrap', columnGap: '0.75rem', rowGap: '0.125rem', m: 0, mt: '0.25rem',
  '& > div': { display: 'flex', columnGap: '0.25rem' },
  '& dt, & dd': { m: 0, typography: 'caption', color: 'text.secondary' },
  '& dt::after': { content: '":"' },
  '& dd': { fontVariantNumeric: 'tabular-nums' },
} as const;

const BuyerOfferLines = <L extends OfferLine & BuyerLineDetails>({ lines, currency, lineName }: { lines: readonly L[]; currency: string; lineName: (line: L) => string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing="0.875rem" divider={<Divider />} data-testid="offer-lines">{lines.map((line) => {
    const kind = line.type === undefined ? null
      : line.type === 'physical' && line.deliveryMethod !== undefined
        ? `${t.salesLinks.lineTypes.physical} · ${t.salesLinks.lineDelivery[line.deliveryMethod]}`
        : t.salesLinks.lineTypes[line.type];
    return <Box key={line.productId} data-testid={`offer-line-${line.productId}`}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', columnGap: '1rem' }}>
        <Typography variant="h3" component="h2">{lineName(line)}</Typography>
        <Typography variant="h3" component="p" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} data-testid="offer-line-gross">
          {formatPrice(line.grossCents, currency, language)}
        </Typography>
      </Box>
      <Box component="dl" sx={TAX_LIST_SX} data-testid="offer-line-cells">{[
        [t.salesLinks.net, formatPrice(line.netCents, currency, language)],
        [t.salesLinks.vatRate, line.vatRate === 'exempt' ? t.salesLinks.exempt : line.vatRate === null ? '—' : `${line.vatRate}%`],
        [t.salesLinks.vat, formatPrice(line.vatCents, currency, language)],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</Box>
      {kind === null ? null : <Typography variant="caption" component="p" color="text.secondary" data-testid="offer-line-kind">{kind}</Typography>}
      {line.vatExemptionBasis === null ? null : <Typography variant="caption" component="p" color="text.secondary">{line.vatExemptionBasis}</Typography>}
    </Box>;
  })}</Stack>;
};

export const OfferLines = <L extends OfferLine & BuyerLineDetails>({ lines, currency, lineName = (line) => line.name, afterName, cells = 'wrap' }: { lines: readonly L[]; currency: string; lineName?: ((line: L) => string) | undefined; afterName?: ((line: L) => ReactNode) | undefined; cells?: 'wrap' | 'grid' }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  if (cells === 'grid') return <BuyerOfferLines lines={lines} currency={currency} lineName={lineName} />;
  return <Stack spacing={2} divider={<Divider />} data-testid="offer-lines">{lines.map((line) => {
    const extra = afterName?.(line);
    return <Box key={line.productId} sx={{ pb: 2 }}>
    <Typography variant="h3">{lineName(line)}</Typography>
    {extra == null ? null : <Box sx={{ mt: 1 }}>{extra}</Box>}
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }} data-testid="offer-line-cells">{[
      [t.salesLinks.net, formatPrice(line.netCents, currency, language)],
      [t.salesLinks.vatRate, line.vatRate === 'exempt' ? t.salesLinks.exempt : line.vatRate === null ? '—' : `${line.vatRate}%`],
      [t.salesLinks.vat, formatPrice(line.vatCents, currency, language)],
      [t.salesLinks.gross, formatPrice(line.grossCents, currency, language)],
    ].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>)}</Box>
    {line.vatExemptionBasis === null ? null : <Typography variant="caption" color="text.secondary">{line.vatExemptionBasis}</Typography>}
  </Box>; })}</Stack>;
};
