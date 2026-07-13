import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
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
import type { Product, ProductAccessIssues } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate, formatPrice } from '../../../lib/format.js';
import { DataValue, EntryDate, PublishedStatus } from '../../../theme.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const AccessIssues = ({ issue }: { issue: ProductAccessIssues }) => {
  const t = useTranslations();
  const rows: { label: string; ids: string[] }[] = [
    { label: t.products.missingCoursesLabel, ids: issue.missingCourseIds },
    { label: t.products.missingModulesLabel, ids: issue.missingModuleIds },
    { label: t.products.missingLessonsLabel, ids: issue.missingLessonIds },
  ].filter((row) => row.ids.length > 0);

  return (
    <Box data-testid="product-access-issues">
      <Typography variant="overline" component="h4">
        {t.products.accessIssuesHeading}
      </Typography>
      <List disablePadding dense>
        {rows.map((row) => (
          <ListItem key={row.label} disableGutters>
            <ListItemText primary={`${row.label}: ${row.ids.join(', ')}`} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
};

const ProductRow = ({
  product,
  issue,
}: {
  product: Product;
  issue?: ProductAccessIssues | undefined;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
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
        {issue ? (
          <Chip size="small" color="warning" variant="outlined" label={t.products.accessIssuesChip} />
        ) : null}
        <Box sx={{ flex: 1 }} />
        {product.published ? null : (
          <Button
            variant="text"
            disabled={publishProduct.isPending}
            onClick={() => publishProduct.mutate({ id: product.id })}
          >
            {t.products.publish}
          </Button>
        )}
      </Stack>
      <Stack useFlexGap spacing="0.2rem">
        <span>
          <DataValue>{formatPrice(product.priceCents, product.currency)}</DataValue> ·{' '}
          {product.published ? <PublishedStatus>{t.products.published}</PublishedStatus> : t.products.draft} ·{' '}
          <DataValue>{accessCount}</DataValue> {t.products.accessItemNoun({ count: accessCount })}
        </span>
        <EntryDate component="time" dateTime={product.createdAt}>
          {formatDate(product.createdAt, language)}
        </EntryDate>
      </Stack>
      {issue ? <AccessIssues issue={issue} /> : null}
      <Box>
        <Button size="small" variant="text" onClick={() => setShowAccess((open) => !open)}>
          {showAccess ? t.products.hideAccess : t.products.editAccess}
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
  const t = useTranslations();
  const products = useQuery(actions.products);
  const accessIssues = useQuery(actions.productAccessIssues);
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
          {t.products.newProduct}
        </Typography>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="product-title">{t.products.titleLabel}</FormLabel>
            <OutlinedInput
              id="product-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
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
            <FormControl fullWidth>
              <FormLabel htmlFor="product-price">{t.products.priceInCents}</FormLabel>
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
              <FormLabel htmlFor="product-currency">{t.products.currencyLabel}</FormLabel>
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
            {createProduct.isPending ? t.products.creating : t.products.create}
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
          {t.products.heading}
        </Typography>
        {products.isPending ? (
          <Typography variant="body1">{t.products.loading}</Typography>
        ) : products.isError ? (
          <Alert>{products.error.message}</Alert>
        ) : products.data.products.length === 0 ? (
          <Typography variant="body1">{t.products.empty}</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {products.data.products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                issue={accessIssues.data?.issues.find((entry) => entry.productId === product.id)}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
