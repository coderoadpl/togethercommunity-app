import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Select,
  TextField,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';

import {
  PRODUCT_TYPES,
  productSlugFromTitle,
  productVatRateSchema,
  type ProductVatRate,
  type ProductType,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { HtmlEditor } from '../../../components/ui/HtmlEditor.js';
import { errorCodeOf, localizePanelError, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { ImageAssetField } from '../ImageAssetField.js';
import { productTypeLabel } from './product-type.js';
import { emptyStockTrackingDraft, StockTrackingFields, stockTrackingInput, type StockTrackingDraft } from './ProductStockSection.js';

export const ProductCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const [type, setType] = useState<ProductType>('course');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [vatRate, setVatRate] = useState<ProductVatRate | null>(null);
  const [vatExemptionBasis, setVatExemptionBasis] = useState('');
  const [stockDraft, setStockDraft] = useState<StockTrackingDraft>(emptyStockTrackingDraft);
  const enableStock = useMutation(actions.enableProductStock);
  const [untrackedProductId, setUntrackedProductId] = useState<string | null>(null);
  const openProduct = (productId: string) => navigate({
    to: '/panel/products/$productId',
    params: { productId },
    hash: hash === 'prices' ? 'prices' : '',
  });

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async ({ product }) => {
      const stockInput = product.type === 'physical' ? stockTrackingInput(product.id, stockDraft) : null;
      const tracked = stockInput === null || await enableStock.mutateAsync(stockInput).then(() => true, () => false);
      await queryClient.invalidateQueries(actions.productsInvalidates());
      if (!tracked) {
        setUntrackedProductId(product.id);
        return;
      }
      await openProduct(product.id);
    },
  });
  const slugError = createProduct.isError && errorCodeOf(createProduct.error) === 'slug_reserved'
    ? localizePanelError(createProduct.error, t)
    : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createProduct.mutate({
      type,
      vatRate,
      vatExemptionBasis: vatRate === 'exempt' ? vatExemptionBasis : null,
      slug: slug.trim(),
      title,
      description,
      coverUrl: coverUrl.trim() === '' ? null : coverUrl.trim(),
      priceCents: 0,
      currency: 'PLN',
    });
  };

  return (
    <PanelPage
      title={t.products.newProduct}
      backTo={<PanelBackLink to="/panel/products">{t.products.allProducts}</PanelBackLink>}
    >
      <SectionCard title={t.products.detailsHeading} onSubmit={submit}>
        <FormControl fullWidth>
          <FormLabel htmlFor="product-type">{t.products.typeLabel}</FormLabel>
          <Select
            id="product-type"
            value={type}
            onChange={(event) =>
              setType(PRODUCT_TYPES.find((candidate) => candidate === event.target.value) ?? type)
            }
            inputProps={{ 'aria-label': t.products.typeLabel }}
          >
            {PRODUCT_TYPES.map((candidate) => (
              <MenuItem key={candidate} value={candidate}>
                {productTypeLabel(candidate, t)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="product-title">{t.products.titleLabel}</FormLabel>
          <OutlinedInput
            id="product-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (!slugTouched) setSlug(productSlugFromTitle(event.target.value));
            }}
            required
          />
        </FormControl>
        <FormControl fullWidth error={slugError !== null}>
          <FormLabel htmlFor="product-slug">{t.products.slugLabel}</FormLabel>
          <OutlinedInput
            id="product-slug"
            value={slug}
            inputProps={{ 'aria-describedby': 'product-slug-helper' }}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            required
          />
          <FormHelperText id="product-slug-helper">{slugError ?? t.products.slugHint}</FormHelperText>
        </FormControl>
        <TextField select label={t.salesLinks.vatRate} value={vatRate ?? ''} onChange={(event) => setVatRate(event.target.value === '' ? null : productVatRateSchema.parse(event.target.value === 'exempt' ? 'exempt' : Number(event.target.value)))}>
          <MenuItem value="">{t.salesLinks.vatDefault}</MenuItem>
          {[5, 8, 23].map((rate) => <MenuItem key={rate} value={rate}>{rate}%</MenuItem>)}
          <MenuItem value="exempt">{t.salesLinks.exempt}</MenuItem>
        </TextField>
        {vatRate === 'exempt' ? <TextField label={t.salesLinks.exemptionBasis} value={vatExemptionBasis} required onChange={(event) => setVatExemptionBasis(event.target.value)} /> : null}
        <HtmlEditor
          id="product-description"
          value={description}
          onChange={setDescription}
          fieldLabel={t.common.description}
        />
        <ImageAssetField
          id="product-cover-url"
          label={t.products.coverUrlLabel}
          hint={t.products.coverUrlHint}
          value={coverUrl}
          onChange={setCoverUrl}
          kind="product-cover"
          testId="product-cover"
        />
        {type === 'physical' ? (
          <StockTrackingFields draft={stockDraft} onChange={setStockDraft} disabled={createProduct.isPending} />
        ) : null}
        <Button type="submit" variant="contained" disabled={createProduct.isPending || untrackedProductId !== null || (type === 'physical' && stockDraft.track && stockTrackingInput('', stockDraft) === null)}>
          {createProduct.isPending ? t.products.creating : t.products.create}
        </Button>
        {createProduct.isError && slugError === null
          ? <Alert severity="error">{localizePanelError(createProduct.error, t)}</Alert>
          : null}
        {untrackedProductId === null ? null : (
          <Alert
            severity="error"
            data-testid="product-stock-enable-error"
            action={<Button color="inherit" size="small" onClick={() => { void openProduct(untrackedProductId); }}>{t.products.stockOpenProduct}</Button>}
          >
            {t.products.stockEnableAfterCreateFailed} {localizePanelError(enableStock.error, t)}
          </Alert>
        )}
      </SectionCard>
    </PanelPage>
  );
};
