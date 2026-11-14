import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProductStock } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { DataValue } from '../../../theme.js';

const wholeNumber = (value: string): number | null => /^\d+$/u.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;
const signedWholeNumber = (value: string): number | null => /^[+-]?\d+$/u.test(value.trim()) ? Number.parseInt(value.trim(), 10) : null;

export interface StockTrackingDraft {
  track: boolean;
  onHand: string;
  threshold: string;
}

export const emptyStockTrackingDraft: StockTrackingDraft = { track: false, onHand: '', threshold: '' };

export const stockTrackingInput = (productId: string, draft: StockTrackingDraft) => {
  const onHand = wholeNumber(draft.onHand);
  const threshold = draft.threshold.trim() === '' ? null : wholeNumber(draft.threshold);
  return !draft.track || onHand === null || (draft.threshold.trim() !== '' && threshold === null)
    ? null
    : { productId, onHand, lowStockThreshold: threshold };
};

export const StockTrackingFields = ({
  draft,
  onChange,
  disabled,
}: {
  draft: StockTrackingDraft;
  onChange: (draft: StockTrackingDraft) => void;
  disabled: boolean;
}) => {
  const t = useTranslations();
  return (
    <Stack useFlexGap spacing="1rem">
      <FormControl>
        <FormControlLabel
          label={t.products.stockTrack}
          control={<Switch checked={draft.track} disabled={disabled} onChange={(_, track) => onChange({ ...draft, track })} />}
        />
        <FormHelperText>{draft.track ? t.products.stockTrackPermanentHint : t.products.stockNotTracked}</FormHelperText>
      </FormControl>
      {draft.track ? (
        <>
          <TextField
            label={t.products.stockOnHand}
            value={draft.onHand}
            required
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, onHand: event.target.value })}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'stock-on-hand-input' } }}
          />
          <TextField
            label={t.products.stockThreshold}
            value={draft.threshold}
            helperText={t.products.stockThresholdHint}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, threshold: event.target.value })}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'stock-threshold-input' } }}
          />
        </>
      ) : null}
    </Stack>
  );
};

const TrackedStock = ({ stock }: { stock: ProductStock }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [threshold, setThreshold] = useState(stock.lowStockThreshold === null ? '' : String(stock.lowStockThreshold));
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.productStockInvalidates(stock.productId)),
      queryClient.invalidateQueries(actions.productsInvalidates()),
      queryClient.invalidateQueries(actions.publicOfferInvalidates()),
    ]);
  };
  const adjust = useMutation({
    ...actions.adjustProductStock,
    onSuccess: async () => {
      setDelta('');
      setReason('');
      await refresh();
    },
  });
  const saveThreshold = useMutation({ ...actions.setProductStockThreshold, onSuccess: refresh });
  const parsedDelta = signedWholeNumber(delta);
  const parsedThreshold = threshold.trim() === '' ? null : wholeNumber(threshold);
  const submitAdjustment = (event: FormEvent) => {
    event.preventDefault();
    if (parsedDelta === null || parsedDelta === 0 || reason.trim() === '') return;
    adjust.mutate({ productId: stock.productId, delta: parsedDelta, reason: reason.trim() });
  };
  const submitThreshold = (event: FormEvent) => {
    event.preventDefault();
    if (threshold.trim() !== '' && parsedThreshold === null) return;
    saveThreshold.mutate({ productId: stock.productId, lowStockThreshold: parsedThreshold });
  };

  return (
    <Stack useFlexGap spacing="1.25rem">
      <FormControl>
        <FormControlLabel label={t.products.stockTrack} control={<Switch checked disabled />} />
        <FormHelperText>{t.products.stockTrackPermanentHint}</FormHelperText>
      </FormControl>
      <Stack direction="row" useFlexGap spacing="2rem" sx={{ flexWrap: 'wrap' }} data-testid="product-stock-levels">
        <Box>
          <Typography variant="body2" color="text.secondary">{t.products.stockOnHand}</Typography>
          <DataValue data-testid="product-stock-on-hand">{stock.onHand}</DataValue>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">{t.products.stockReserved}</Typography>
          <DataValue data-testid="product-stock-reserved">{stock.reserved}</DataValue>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">{t.products.stockAvailable}</Typography>
          <DataValue data-testid="product-stock-available">{stock.soldOut ? t.products.stockSoldOut : stock.available}</DataValue>
        </Box>
      </Stack>
      <Stack component="form" onSubmit={submitAdjustment} direction="row" useFlexGap spacing="0.75rem" sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField
          label={t.products.stockAdjustDelta}
          value={delta}
          required
          disabled={adjust.isPending}
          onChange={(event) => setDelta(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'stock-adjust-delta' } }}
        />
        <TextField
          label={t.products.stockAdjustReason}
          value={reason}
          required
          disabled={adjust.isPending}
          onChange={(event) => setReason(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'stock-adjust-reason' } }}
        />
        <Button type="submit" variant="outlined" disabled={adjust.isPending || parsedDelta === null || parsedDelta === 0 || reason.trim() === ''}>
          {adjust.isPending ? t.products.stockAdjusting : t.products.stockAdjust}
        </Button>
      </Stack>
      <Stack component="form" onSubmit={submitThreshold} direction="row" useFlexGap spacing="0.75rem" sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField
          label={t.products.stockThreshold}
          value={threshold}
          helperText={t.products.stockThresholdHint}
          disabled={saveThreshold.isPending}
          onChange={(event) => setThreshold(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'stock-threshold-input' } }}
        />
        <Button type="submit" variant="outlined" disabled={saveThreshold.isPending || (threshold.trim() !== '' && parsedThreshold === null)}>
          {saveThreshold.isPending ? t.products.stockSavingThreshold : t.products.stockSaveThreshold}
        </Button>
      </Stack>
      {adjust.isError ? <Alert severity="error">{localizePanelError(adjust.error, t)}</Alert> : null}
      {saveThreshold.isError ? <Alert severity="error">{localizePanelError(saveThreshold.error, t)}</Alert> : null}
    </Stack>
  );
};

const UntrackedStock = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StockTrackingDraft>(emptyStockTrackingDraft);
  const enable = useMutation({
    ...actions.enableProductStock,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(actions.productStockInvalidates(productId)),
        queryClient.invalidateQueries(actions.productsInvalidates()),
        queryClient.invalidateQueries(actions.publicOfferInvalidates()),
      ]);
    },
  });
  const input = stockTrackingInput(productId, draft);
  return (
    <Stack component="form" useFlexGap spacing="1rem" onSubmit={(event: FormEvent) => {
      event.preventDefault();
      if (input !== null) enable.mutate(input);
    }}>
      <StockTrackingFields draft={draft} onChange={setDraft} disabled={enable.isPending} />
      {draft.track ? (
        <Box>
          <Button type="submit" variant="contained" disabled={enable.isPending || input === null}>
            {enable.isPending ? t.products.stockEnabling : t.products.stockEnable}
          </Button>
        </Box>
      ) : null}
      {enable.isError ? <Alert severity="error">{localizePanelError(enable.error, t)}</Alert> : null}
    </Stack>
  );
};

export const ProductStockSection = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const stock = useQuery(actions.productStock(productId));
  return (
    <SectionCard title={t.products.stockHeading} description={t.products.stockDescription} data-testid="product-stock-section">
      {stock.isPending ? (
        <StatusView surface={false} state={{ kind: 'loading', label: t.common.loading }} />
      ) : stock.isError ? (
        <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(stock.error, t), retry: { label: t.common.retry, onRetry: () => void stock.refetch() } }} />
      ) : stock.data.stock === null ? (
        <UntrackedStock productId={productId} />
      ) : (
        <TrackedStock key={stock.data.stock.updatedAt} stock={stock.data.stock} />
      )}
    </SectionCard>
  );
};

export const productStockSummary = (stock: ProductStock, t: ReturnType<typeof useTranslations>): string =>
  stock.soldOut
    ? t.products.stockSoldOut
    : `${t.products.stockListSummary({ onHand: stock.onHand, reserved: stock.reserved })}${stock.low ? ` · ${t.products.stockLow}` : ''}`;
