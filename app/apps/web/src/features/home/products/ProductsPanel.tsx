import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Divider,
  FormControl,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { Product } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { DataValue, EntryDate, PublishedStatus } from '../../../theme.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const priceFormatter = (priceCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(priceCents / 100);

const displayDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

const ProductRow = ({ product }: { product: Product }) => {
  const queryClient = useQueryClient();
  const [showAccess, setShowAccess] = useState(false);

  const publishProduct = useMutation({
    ...actions.publishProduct,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
    },
  });

  const accessCount = product.accessItems.length;

  return (
    <Paper elevation={1} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }} data-testid="product-row">
      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h2" component="h3">
          {product.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {product.published ? null : (
          <Button
            variant="text"
            disabled={publishProduct.isPending}
            onClick={() => publishProduct.mutate({ id: product.id })}
          >
            publish
          </Button>
        )}
      </Stack>
      <Stack useFlexGap spacing="0.2rem">
        <span>
          <DataValue>{priceFormatter(product.priceCents, product.currency)}</DataValue> ·{' '}
          {product.published ? <PublishedStatus>published</PublishedStatus> : 'draft'} ·{' '}
          <DataValue>{accessCount}</DataValue> access item{accessCount === 1 ? '' : 's'}
        </span>
        <EntryDate component="time" dateTime={product.createdAt}>
          {displayDate(product.createdAt)}
        </EntryDate>
      </Stack>
      <Box>
        <Button size="small" variant="text" onClick={() => setShowAccess((open) => !open)}>
          {showAccess ? 'hide access' : 'edit access'}
        </Button>
      </Box>
      <Collapse in={showAccess} unmountOnExit>
        <Divider sx={{ mb: '0.75rem' }} />
        <ProductAccessEditor product={product} />
      </Collapse>
      {publishProduct.isError ? (
        <Alert>
          {publishProduct.error instanceof ApiError
            ? publishProduct.error.appError.message
            : publishProduct.error.message}
        </Alert>
      ) : null}
    </Paper>
  );
};

export const ProductsPanel = () => {
  const products = useQuery(actions.products);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceCents, setPriceCents] = useState('0');
  const [currency, setCurrency] = useState('PLN');

  const invalidateProducts = async () => {
    await queryClient.invalidateQueries(actions.productsInvalidates());
  };

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async () => {
      setTitle('');
      setDescription('');
      setPriceCents('0');
      setCurrency('PLN');
      await invalidateProducts();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createProduct.mutate({
      title,
      description,
      priceCents: Number(priceCents),
      currency: currency.toUpperCase(),
    });
  };

  return (
    <Stack useFlexGap spacing="2rem">
      <Paper
        elevation={1}
        component="form"
        onSubmit={submit}
        sx={{ p: '1rem', display: 'grid', gap: '1rem' }}
      >
        <Typography variant="h2" component="h2">
          New product
        </Typography>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="product-title">title</FormLabel>
            <OutlinedInput
              id="product-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="product-description">description</FormLabel>
            <OutlinedInput
              id="product-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              multiline
              minRows={3}
            />
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
            <FormControl fullWidth>
              <FormLabel htmlFor="product-price">price in cents</FormLabel>
              <OutlinedInput
                id="product-price"
                type="number"
                inputProps={{ min: 0, step: 1 }}
                value={priceCents}
                onChange={(event) => setPriceCents(event.target.value)}
                required
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel htmlFor="product-currency">currency</FormLabel>
              <OutlinedInput
                id="product-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                inputProps={{ maxLength: 3 }}
                required
              />
            </FormControl>
          </Stack>
          <Button type="submit" variant="contained" disabled={createProduct.isPending}>
            {createProduct.isPending ? 'creating…' : 'create product'}
          </Button>
        </Stack>
        {createProduct.isError ? (
          <Alert>
            {createProduct.error instanceof ApiError
              ? createProduct.error.appError.message
              : createProduct.error.message}
          </Alert>
        ) : null}
      </Paper>

      <Box component="section">
        <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
          Products
        </Typography>
        {products.isPending ? (
          <Typography variant="body1">loading products…</Typography>
        ) : products.isError ? (
          <Alert>{products.error.message}</Alert>
        ) : products.data.products.length === 0 ? (
          <Typography variant="body1">No products yet.</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {products.data.products.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
