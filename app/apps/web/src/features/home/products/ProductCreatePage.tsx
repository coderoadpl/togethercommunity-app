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
  Stack,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { priceMajorSchema, SUPPORTED_CURRENCIES } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

export const ProductCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('0');
  const [currency, setCurrency] = useState<string>('PLN');
  const [priceError, setPriceError] = useState(false);

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
      await navigate({ to: '/panel/products' });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsedPrice = priceMajorSchema.safeParse(price);
    if (!parsedPrice.success) {
      setPriceError(true);
      return;
    }
    setPriceError(false);
    createProduct.mutate({ title, description, priceCents: parsedPrice.data, currency });
  };

  return (
    <PanelPage
      title={t.products.newProduct}
      backTo={{ label: t.products.allProducts, href: '/panel/products' }}
    >
      <SectionCard title={t.products.newProduct} onSubmit={submit}>
        <FormControl fullWidth>
          <FormLabel htmlFor="product-title">{t.products.titleLabel}</FormLabel>
          <OutlinedInput id="product-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="product-description">{t.common.description}</FormLabel>
          <OutlinedInput
            id="product-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={3}
          />
        </FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
          <FormControl fullWidth error={priceError}>
            <FormLabel htmlFor="product-price">{t.products.priceLabel}</FormLabel>
            <OutlinedInput
              id="product-price"
              type="text"
              inputProps={{ inputMode: 'decimal', 'aria-describedby': 'product-price-helper' }}
              value={price}
              onChange={(event) => {
                setPriceError(false);
                setPrice(event.target.value);
              }}
              required
            />
            <FormHelperText id="product-price-helper">
              {priceError ? t.products.priceInvalid : t.products.priceHelper}
            </FormHelperText>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="product-currency">{t.products.currencyLabel}</FormLabel>
            <Select
              id="product-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              inputProps={{ 'aria-label': t.products.currencyLabel }}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <MenuItem key={code} value={code}>
                  {code}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Button type="submit" variant="contained" disabled={createProduct.isPending}>
          {createProduct.isPending ? t.products.creating : t.products.create}
        </Button>
        {createProduct.isError ? <Alert>{localizeError(createProduct.error, t)}</Alert> : null}
      </SectionCard>
    </PanelPage>
  );
};
