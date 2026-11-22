import type { ReactNode } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { OfferCellValue } from '../../theme.js';

export type OfferLine = { productId: string; name: string; grossCents: number; netCents: number; vatRate: number | 'exempt' | null; vatCents: number; vatExemptionBasis: string | null };

const CELL_SX = {
  wrap: { display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 },
  grid: { display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, columnGap: '1rem', rowGap: '0.5rem', mt: '0.5rem' },
} as const;

export const OfferLines = <L extends OfferLine>({ lines, currency, lineName = (line) => line.name, afterName, cells = 'wrap' }: { lines: readonly L[]; currency: string; lineName?: ((line: L) => string) | undefined; afterName?: ((line: L) => ReactNode) | undefined; cells?: 'wrap' | 'grid' }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing={cells === 'grid' ? '0.875rem' : 2} divider={<Divider />} data-testid="offer-lines">{lines.map((line) => {
    const extra = afterName?.(line);
    return <Box key={line.productId} sx={{ pb: cells === 'grid' ? 0 : 2 }}>
    <Typography variant="h3">{lineName(line)}</Typography>
    {extra == null ? null : <Box sx={{ mt: 1 }}>{extra}</Box>}
    <Box sx={CELL_SX[cells]} data-testid="offer-line-cells">{[
      [t.salesLinks.net, formatPrice(line.netCents, currency, language)],
      [t.salesLinks.vatRate, line.vatRate === 'exempt' ? t.salesLinks.exempt : line.vatRate === null ? '—' : `${line.vatRate}%`],
      [t.salesLinks.vat, formatPrice(line.vatCents, currency, language)],
      [t.salesLinks.gross, formatPrice(line.grossCents, currency, language)],
    ].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography>{cells === 'grid' ? <OfferCellValue>{value}</OfferCellValue> : <Typography>{value}</Typography>}</Box>)}</Box>
    {line.vatExemptionBasis === null ? null : <Typography variant="caption" color="text.secondary">{line.vatExemptionBasis}</Typography>}
  </Box>; })}</Stack>;
};
