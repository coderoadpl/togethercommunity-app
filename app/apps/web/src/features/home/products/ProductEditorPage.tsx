import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { priceMajorSchema, SUPPORTED_CURRENCIES, type PriceKind, type Product, type ProductPrice } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatPrice } from '../../../lib/format.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const PriceRow = ({ price, onDeactivate }: { price: ProductPrice; onDeactivate: (price: ProductPrice) => void }) => {
  const t = useTranslations();
  const { language } = useLanguage();

  return (
    <TableRow data-testid="price-row">
      <TableCell>{price.kind === 'one_time' ? t.products.oneTime : t.products.recurring}</TableCell>
      <TableCell>
        {price.interval === null ? '—' : price.interval === 'month' ? t.products.month : t.products.year}
      </TableCell>
      <TableCell>{formatPrice(price.amountCents, price.currency, language)}</TableCell>
      <TableCell>{price.currency}</TableCell>
      <TableCell>
        <Chip
          size="small"
          color={price.active ? 'success' : 'default'}
          variant={price.active ? 'filled' : 'outlined'}
          label={price.active ? t.products.active : t.products.inactive}
        />
      </TableCell>
      <TableCell align="right">
        {price.active ? (
          <Button size="small" color="error" onClick={() => onDeactivate(price)}>
            {t.products.deactivate}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
};

const PricesSection = ({ product }: { product: Product }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const prices = useQuery(actions.productPrices(product.id));
  const [kind, setKind] = useState<PriceKind>('one_time');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(product.currency);
  const [amountError, setAmountError] = useState(false);
  const [deactivating, setDeactivating] = useState<ProductPrice | null>(null);

  const createPrice = useMutation({
    ...actions.createProductPrice,
    onSuccess: async () => {
      setAmount('');
      await queryClient.invalidateQueries(actions.productPricesInvalidates(product.id));
    },
  });
  const deactivatePrice = useMutation({
    ...actions.deactivateProductPrice,
    onSuccess: async () => {
      setDeactivating(null);
      await queryClient.invalidateQueries(actions.productPricesInvalidates(product.id));
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = priceMajorSchema.safeParse(amount);
    if (!parsed.success) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    createPrice.mutate({
      productId: product.id,
      kind,
      ...(kind === 'recurring' ? { interval } : {}),
      amountCents: parsed.data,
      currency,
    });
  };

  return (
    <>
      <SectionCard
        title={t.products.pricesHeading}
        description={t.products.pricesDescription}
        onSubmit={submit}
        actions={
          <Button type="submit" variant="contained" disabled={createPrice.isPending}>
            {createPrice.isPending ? t.products.creatingPrice : t.products.addPrice}
          </Button>
        }
        data-testid="prices-section"
      >
        {prices.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.products.loading }} surface={false} />
        ) : prices.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(prices.error, t) }} surface={false} />
        ) : prices.data.prices.length === 0 ? (
          <Typography>{t.products.pricesEmpty}</Typography>
        ) : (
          <ResponsiveTable>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t.products.kindLabel}</TableCell>
                  <TableCell>{t.products.intervalLabel}</TableCell>
                  <TableCell>{t.sales.amount}</TableCell>
                  <TableCell>{t.products.currencyLabel}</TableCell>
                  <TableCell>{t.sales.status}</TableCell>
                  <TableCell align="right">
                    <Box
                      component="span"
                      sx={{
                        position: 'absolute',
                        width: 1,
                        height: 1,
                        overflow: 'hidden',
                        clip: 'rect(0 0 0 0)',
                      }}
                    >
                      {t.products.actionsLabel}
                    </Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {prices.data.prices.map((price) => (
                  <PriceRow key={price.id} price={price} onDeactivate={setDeactivating} />
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="price-kind">{t.products.kindLabel}</FormLabel>
            <Select
              id="price-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value === 'recurring' ? 'recurring' : 'one_time')}
              inputProps={{ 'aria-label': t.products.kindLabel }}
            >
              <MenuItem value="one_time">{t.products.oneTime}</MenuItem>
              <MenuItem value="recurring">{t.products.recurring}</MenuItem>
            </Select>
          </FormControl>
          {kind === 'recurring' ? (
            <FormControl fullWidth>
              <FormLabel htmlFor="price-interval">{t.products.intervalLabel}</FormLabel>
              <Select
                id="price-interval"
                value={interval}
                onChange={(event) => setInterval(event.target.value === 'year' ? 'year' : 'month')}
                inputProps={{ 'aria-label': t.products.intervalLabel }}
              >
                <MenuItem value="month">{t.products.month}</MenuItem>
                <MenuItem value="year">{t.products.year}</MenuItem>
              </Select>
            </FormControl>
          ) : null}
          <FormControl fullWidth error={amountError}>
            <FormLabel htmlFor="price-amount">{t.products.priceLabel}</FormLabel>
            <OutlinedInput
              id="price-amount"
              value={amount}
              onChange={(event) => {
                setAmountError(false);
                setAmount(event.target.value);
              }}
              inputProps={{ inputMode: 'decimal' }}
              required
            />
            <FormHelperText>{amountError ? t.products.priceInvalid : t.products.priceHelper}</FormHelperText>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="price-currency">{t.products.currencyLabel}</FormLabel>
            <Select
              id="price-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              inputProps={{ 'aria-label': t.products.currencyLabel }}
            >
              {SUPPORTED_CURRENCIES.map((code) => <MenuItem key={code} value={code}>{code}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        {createPrice.isError ? <Alert severity="error">{localizeError(createPrice.error, t)}</Alert> : null}
        {deactivatePrice.isError ? <Alert severity="error">{localizeError(deactivatePrice.error, t)}</Alert> : null}
      </SectionCard>

      <ConfirmDialog
        open={deactivating !== null}
        title={t.products.deactivateTitle}
        body={t.products.deactivateBody}
        cancelLabel={t.common.cancel}
        confirmLabel={deactivatePrice.isPending ? t.products.deactivating : t.products.deactivateConfirm}
        pending={deactivatePrice.isPending}
        onClose={() => setDeactivating(null)}
        onConfirm={() => {
          if (deactivating !== null) deactivatePrice.mutate({ id: deactivating.id });
        }}
      />
    </>
  );
};

const CheckoutConsentsSection = ({ product }: { product: Product }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const definitions = useQuery(actions.marketingConsents);
  const [selected, setSelected] = useState<string[]>(product.checkoutConsentDefinitionIds ?? []);
  const save = useMutation({
    ...actions.updateProductAccessItems,
    onSuccess: async () => queryClient.invalidateQueries(actions.productsInvalidates()),
  });
  const activeDefinitions = (definitions.data?.definitions ?? []).filter((definition) =>
    definition.kind === 'optional_marketing' && definition.status === 'active');

  return (
    <SectionCard
      title={t.products.checkoutConsentsHeading}
      description={t.products.checkoutConsentsDescription}
      actions={(
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={() => save.mutate({
            id: product.id,
            accessItems: product.accessItems,
            checkoutConsentDefinitionIds: selected,
          })}
        >
          {save.isPending ? t.products.checkoutConsentsSaving : t.products.checkoutConsentsSave}
        </Button>
      )}
    >
      <FormControl fullWidth>
        <FormLabel id="product-checkout-consents-label">{t.products.checkoutConsentsLabel}</FormLabel>
        <Select
          multiple
          labelId="product-checkout-consents-label"
          value={selected}
          disabled={definitions.isPending}
          onChange={(event) => setSelected(
            typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value,
          )}
          renderValue={(ids) => ids.length === 0
            ? t.products.checkoutConsentsNone
            : ids.map((id) => activeDefinitions.find((definition) => definition.id === id)?.key ?? id).join(', ')}
        >
          {activeDefinitions.map((definition) => (
            <MenuItem key={definition.id} value={definition.id}>{definition.key}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {definitions.isError || save.isError ? (
        <Alert>{localizeError(definitions.error ?? save.error, t)}</Alert>
      ) : null}
    </SectionCard>
  );
};

export const ProductEditorPage = ({ product }: { product: Product }) => {
  const t = useTranslations();

  return (
    <PanelPage title={product.title} backTo={{ label: t.products.allProducts, href: '/panel/products' }}>
      <PricesSection product={product} />
      <CheckoutConsentsSection product={product} />
      <SectionCard title={t.access.heading}>
        <ProductAccessEditor product={product} />
      </SectionCard>
    </PanelPage>
  );
};
