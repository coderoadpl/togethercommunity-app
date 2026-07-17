import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Snackbar,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { priceMajorSchema, SUPPORTED_CURRENCIES } from '@core/domain/index.js';
import type { Product, ProductAccessIssues } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate, formatPrice } from '../../../lib/format.js';
import { DataValue, EntryDate, PublishedStatus } from '../../../theme.js';
import { ProductAccessEditor } from './ProductAccessEditor.js';

const AccessIssues = ({ issue }: { issue: ProductAccessIssues }) => {
  const t = useTranslations();
  const rows: { label: string; ids: string[] }[] = [
    { label: t.products.missingCoursesLabel, ids: issue.missingCourseIds },
    { label: t.products.missingModulesLabel, ids: issue.missingModuleIds },
    { label: t.products.missingLessonsLabel, ids: issue.missingLessonIds },
    { label: t.products.unreachableModulesLabel, ids: issue.unreachableModuleIds },
    { label: t.products.unreachableLessonsLabel, ids: issue.unreachableLessonIds },
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

const CopyLinkGlyph = () => (
  <SvgIcon fontSize="small" aria-hidden viewBox="0 0 24 24">
    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
  </SvgIcon>
);

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
  const [copied, setCopied] = useState(false);

  const publishProduct = useMutation({
    ...actions.publishProduct,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
    },
  });

  const accessCount = product.accessItems.length;

  const copyCheckoutLink = () => {
    const url = `${window.location.origin}/checkout/${product.id}`;
    void navigator.clipboard?.writeText(url);
    setCopied(true);
  };

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
        <Tooltip title={t.products.copyCheckoutLink}>
          <IconButton
            size="small"
            onClick={copyCheckoutLink}
            aria-label={t.products.copyCheckoutLink}
            data-testid={`copy-checkout-${product.id}`}
          >
            <CopyLinkGlyph />
          </IconButton>
        </Tooltip>
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
      <Snackbar
        open={copied}
        autoHideDuration={3000}
        onClose={() => setCopied(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message={t.products.checkoutLinkCopied}
      />
      <Stack useFlexGap spacing="0.2rem">
        <span>
          <DataValue>{formatPrice(product.priceCents, product.currency, language)}</DataValue> ·{' '}
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
        <Alert>{localizeError(publishProduct.error, t)}</Alert>
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
  const [price, setPrice] = useState('0');
  const [currency, setCurrency] = useState<string>('PLN');
  const [priceError, setPriceError] = useState(false);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search);

  const invalidateProducts = async () => {
    await queryClient.invalidateQueries(actions.productsInvalidates());
  };

  const visibleProducts = (products.data?.products ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((product) => matchesQuery(query, product.title));
  const paged = usePagedList(visibleProducts, query);

  const createProduct = useMutation({
    ...actions.createProduct,
    onSuccess: async () => {
      setTitle('');
      setDescription('');
      setPrice('0');
      setCurrency('PLN');
      setPriceError(false);
      await invalidateProducts();
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
    createProduct.mutate({
      title,
      description,
      priceCents: parsedPrice.data,
      currency,
    });
  };

  return (
    <PanelPage title={t.sections.products}>
      <SectionCard title={t.products.newProduct} onSubmit={submit}>
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
        {createProduct.isError ? (
          <Alert>{localizeError(createProduct.error, t)}</Alert>
        ) : null}
      </SectionCard>

      <Box component="section">
        <Stack
          direction="row"
          useFlexGap
          sx={{ mb: '1rem', flexWrap: 'wrap', alignItems: 'center', columnGap: '1rem', rowGap: '0.6rem' }}
        >
          <Typography variant="h2" component="h2">
            {t.products.heading}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.products.searchPlaceholder}
            testId="products-search"
          />
        </Stack>
        {products.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.products.loading }} />
        ) : products.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(products.error, t) }} />
        ) : products.data.products.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.products.empty }} />
        ) : visibleProducts.length === 0 ? (
          <Typography variant="body1">{t.products.noMatches}</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {paged.pageItems.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                issue={accessIssues.data?.issues.find((entry) => entry.productId === product.id)}
              />
            ))}
          </Stack>
        )}
        <ListPagination paged={paged} testId="products-pagination" />
      </Box>
    </PanelPage>
  );
};
