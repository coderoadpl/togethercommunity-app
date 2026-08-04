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
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';

import {
  PRODUCT_TYPES,
  productCoverUrlSchema,
  productSlugFromTitle,
  type ProductType,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { HtmlEditor } from '../../../components/ui/HtmlEditor.js';
import { CoverPreview } from '../../../components/ui/CoverPreview.js';
import { errorCodeOf, localizeError, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { productTypeLabel } from './product-type.js';

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

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async ({ product }) => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
      await navigate({
        to: '/panel/products/$productId',
        params: { productId: product.id },
        hash: hash === 'prices' ? 'prices' : '',
      });
    },
  });
  const parsedCoverUrl = productCoverUrlSchema.safeParse(coverUrl);
  const coverPreviewUrl = parsedCoverUrl.success ? parsedCoverUrl.data : null;
  const slugError = createProduct.isError && errorCodeOf(createProduct.error) === 'slug_reserved'
    ? localizeError(createProduct.error, t)
    : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createProduct.mutate({
      type,
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
        <HtmlEditor
          id="product-description"
          value={description}
          onChange={setDescription}
          fieldLabel={t.common.description}
        />
        <FormControl fullWidth>
          <FormLabel htmlFor="product-cover-url">{t.products.coverUrlLabel}</FormLabel>
          <OutlinedInput
            id="product-cover-url"
            type="url"
            value={coverUrl}
            onChange={(event) => setCoverUrl(event.target.value)}
          />
          <FormHelperText>{t.products.coverUrlHint}</FormHelperText>
        </FormControl>
        {coverPreviewUrl === null ? null : (
          <CoverPreview
            key={coverPreviewUrl}
            src={coverPreviewUrl}
            label={title === '' ? t.products.coverUrlLabel : title}
            testId="product-cover-preview"
          />
        )}
        <Button type="submit" variant="contained" disabled={createProduct.isPending}>
          {createProduct.isPending ? t.products.creating : t.products.create}
        </Button>
        {createProduct.isError && slugError === null
          ? <Alert severity="error">{localizeError(createProduct.error, t)}</Alert>
          : null}
      </SectionCard>
    </PanelPage>
  );
};
