import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  List,
  ListItem,
  ListItemText,
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

import {
  priceMajorSchema,
  productCoverUrlSchema,
  SUPPORTED_CURRENCIES,
  type PriceKind,
  type Product,
  type ProductPrice,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { HtmlEditor } from '../../../components/ui/HtmlEditor.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatFileSize, formatPrice } from '../../../lib/format.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const ProductDetailsSection = ({ product }: { product: Product }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [coverUrl, setCoverUrl] = useState(product.coverUrl ?? '');
  const save = useMutation({
    ...actions.updateProduct,
    onSuccess: async () => queryClient.invalidateQueries(actions.productsInvalidates()),
  });
  const parsedCoverUrl = productCoverUrlSchema.safeParse(coverUrl);
  const coverPreviewUrl = parsedCoverUrl.success ? parsedCoverUrl.data : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate({
      id: product.id,
      title: title.trim(),
      description,
      coverUrl: coverUrl.trim() === '' ? null : coverUrl.trim(),
    });
  };

  const resetFeedback = () => {
    if (save.isSuccess || save.isError) save.reset();
  };

  return (
    <SectionCard
      title={t.products.detailsHeading}
      onSubmit={submit}
      actions={(
        <Button type="submit" variant="contained" disabled={save.isPending || title.trim().length === 0}>
          {save.isPending ? t.products.savingDetails : t.products.saveDetails}
        </Button>
      )}
      data-testid="product-details-section"
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="product-title">{t.products.titleLabel}</FormLabel>
        <OutlinedInput
          id="product-title"
          value={title}
          required
          onChange={(event) => {
            resetFeedback();
            setTitle(event.target.value);
          }}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="product-slug">{t.products.slugLabel}</FormLabel>
        <OutlinedInput
          id="product-slug"
          value={product.slug}
          readOnly
          inputProps={{ 'aria-describedby': 'product-slug-helper' }}
        />
        <FormHelperText id="product-slug-helper">{t.products.slugImmutableHint}</FormHelperText>
      </FormControl>
      <HtmlEditor
        id="product-description"
        value={description}
        onChange={(value) => {
          resetFeedback();
          setDescription(value);
        }}
        fieldLabel={t.common.description}
      />
      <FormControl fullWidth>
        <FormLabel htmlFor="product-cover-url">{t.products.coverUrlLabel}</FormLabel>
        <OutlinedInput
          id="product-cover-url"
          type="url"
          value={coverUrl}
          onChange={(event) => {
            resetFeedback();
            setCoverUrl(event.target.value);
          }}
        />
        <FormHelperText>{t.products.coverUrlHint}</FormHelperText>
      </FormControl>
      {coverPreviewUrl === null ? null : (
        <Box
          component="img"
          src={coverPreviewUrl}
          alt={title}
          data-testid="product-cover-preview"
          sx={{ width: '100%', maxHeight: 320, objectFit: 'cover' }}
        />
      )}
      {save.isSuccess ? <Alert severity="success">{t.products.detailsSaved}</Alert> : null}
      {save.isError ? <Alert severity="error">{localizeError(save.error, t)}</Alert> : null}
    </SectionCard>
  );
};

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
  const [kind, setKind] = useState<PriceKind>(product.type === 'membership' ? 'recurring' : 'one_time');
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
        description={product.type === 'membership'
          ? t.products.membershipPricesDescription
          : t.products.pricesDescription}
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
          <StatusView state={{ kind: 'error', message: localizeError(prices.error, t), retry: { label: t.common.retry, onRetry: () => void prices.refetch() } }} surface={false} />
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
              disabled={product.type === 'membership'}
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
      {definitions.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(definitions.error, t), retry: { label: t.common.retry, onRetry: () => void definitions.refetch() } }} /> : null}
      {save.isError ? <Alert severity="error">{localizeError(save.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const DownloadAssetsSection = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const assets = useQuery(actions.productDownloadAssets(productId));
  const refresh = async () => {
    await queryClient.invalidateQueries(actions.productDownloadAssetsInvalidates(productId));
  };
  const upload = useMutation({
    ...actions.uploadProductDownload,
    onSuccess: refresh,
  });
  const remove = useMutation({
    ...actions.deleteProductDownload,
    onSuccess: refresh,
  });
  const selectFile = (file: File | undefined) => {
    if (file === undefined) return;
    upload.mutate({
      productId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      body: file,
    });
  };

  return (
    <SectionCard
      title={t.products.downloadsHeading}
      description={t.products.downloadsDescription}
      data-testid="product-download-assets"
    >
      {assets.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.common.loading }} surface={false} />
      ) : assets.isError ? (
        <StatusView surface={false} state={{ kind: 'error', message: localizeError(assets.error, t), retry: { label: t.common.retry, onRetry: () => void assets.refetch() } }} />
      ) : assets.data.assets.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="product-download-assets-empty">
          {t.products.downloadsEmpty}
        </Typography>
      ) : (
        <List disablePadding>
          {assets.data.assets.map((asset) => (
            <ListItem key={asset.id} disableGutters>
              <ListItemText
                primary={asset.fileName}
                secondary={formatFileSize(asset.sizeBytes, language)}
              />
              <Chip
                size="small"
                color={asset.status === 'ready' ? 'success' : 'warning'}
                variant="outlined"
                label={asset.status === 'ready'
                  ? t.products.downloadStatusReady
                  : t.products.downloadStatusPending}
              />
              <Button
                size="small"
                color="error"
                aria-label={t.products.deleteDownload({ name: asset.fileName })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ productId, assetId: asset.id })}
              >
                {t.common.remove}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      <Box>
        <Button component="label" variant="outlined" disabled={upload.isPending}>
          {upload.isPending ? t.products.uploadingDownload : t.products.uploadDownload}
          <input
            hidden
            type="file"
            aria-label={t.products.downloadFileInput}
            onChange={(event) => {
              selectFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </Button>
      </Box>
      {upload.isError ? <Alert severity="error">{localizeError(upload.error, t)}</Alert> : null}
      {remove.isError ? <Alert severity="error">{localizeError(remove.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const ProductEditorPage = ({ product }: { product: Product }) => {
  const t = useTranslations();

  return (
    <PanelPage title={product.title} backTo={{ label: t.products.allProducts, href: '/panel/products' }}>
      <ProductDetailsSection product={product} />
      <Box id="prices" sx={{ scrollMarginTop: '1rem' }}>
        <PricesSection product={product} />
      </Box>
      {product.type === 'digital_download' ? <DownloadAssetsSection productId={product.id} /> : null}
      <CheckoutConsentsSection product={product} />
      <SectionCard title={t.access.heading}>
        <ProductAccessEditor product={product} />
      </SectionCard>
    </PanelPage>
  );
};
