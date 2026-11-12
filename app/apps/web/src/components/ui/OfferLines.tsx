import type { ReactNode } from 'react';
import type { PublicProductVariant } from '#core/domain/index.js';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';

type OfferLine = { productId: string; name: string; grossCents: number; netCents: number; vatRate: number | 'exempt' | null; vatCents: number; vatExemptionBasis: string | null; baseProductId?: string | undefined; variants?: PublicProductVariant[] | undefined };

export const OfferLines = ({ lines, currency, afterName }: { lines: readonly OfferLine[]; currency: string; afterName?: ((line: OfferLine) => ReactNode) | undefined }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing={2} divider={<Divider />} data-testid="offer-lines">{lines.map((line) => {
    const extra = afterName?.(line);
    return <Box key={line.productId} sx={{ pb: 2 }}>
    <Typography variant="h3">{line.name}</Typography>
    {extra == null ? null : <Box sx={{ mt: 1 }}>{extra}</Box>}
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>{[
      [t.salesLinks.net, formatPrice(line.netCents, currency, language)],
      [t.salesLinks.vatRate, line.vatRate === 'exempt' ? t.salesLinks.exempt : line.vatRate === null ? '—' : `${line.vatRate}%`],
      [t.salesLinks.vat, formatPrice(line.vatCents, currency, language)],
      [t.salesLinks.gross, formatPrice(line.grossCents, currency, language)],
    ].map(([label, value]) => <Box key={label}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography>{value}</Typography></Box>)}</Stack>
    {line.vatExemptionBasis === null ? null : <Typography variant="caption" color="text.secondary">{line.vatExemptionBasis}</Typography>}
  </Box>; })}</Stack>;
};
