import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../../api.js';
import { EntryDate } from '../../../theme.js';

const priceFormatter = (priceCents: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).format(priceCents / 100);

const displayDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

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

  const publishProduct = useMutation({
    ...actions.publishProduct,
    onSuccess: invalidateProducts,
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
          <List disablePadding>
            {products.data.products.map((product) => (
              <ListItem
                key={product.id}
                secondaryAction={
                  product.published ? null : (
                    <Button
                      variant="text"
                      disabled={publishProduct.isPending}
                      onClick={() => publishProduct.mutate({ id: product.id })}
                    >
                      publish
                    </Button>
                  )
                }
              >
                <ListItemText
                  primary={product.title}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Stack useFlexGap spacing="0.2rem">
                      <span>
                        {priceFormatter(product.priceCents, product.currency)} ·{' '}
                        {product.published ? 'published' : 'draft'}
                      </span>
                      <EntryDate component="time" dateTime={product.createdAt}>
                        {displayDate(product.createdAt)}
                      </EntryDate>
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
        {publishProduct.isError ? (
          <Alert sx={{ mt: '1rem' }}>
            {publishProduct.error instanceof ApiError
              ? publishProduct.error.appError.message
              : publishProduct.error.message}
          </Alert>
        ) : null}
      </Box>
    </Stack>
  );
};
