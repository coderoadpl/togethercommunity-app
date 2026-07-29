import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

export const ProductCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async ({ product }) => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
      await navigate({ to: '/panel/products/$productId', params: { productId: product.id } });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createProduct.mutate({ title, description, priceCents: 0, currency: 'PLN' });
  };

  return (
    <PanelPage
      title={t.products.newProduct}
      backTo={{ label: t.products.allProducts, href: '/panel/products' }}
    >
      <SectionCard title={t.products.detailsHeading} onSubmit={submit}>
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
        <Button type="submit" variant="contained" disabled={createProduct.isPending}>
          {createProduct.isPending ? t.products.creating : t.products.create}
        </Button>
        {createProduct.isError ? <Alert>{localizeError(createProduct.error, t)}</Alert> : null}
      </SectionCard>
    </PanelPage>
  );
};
