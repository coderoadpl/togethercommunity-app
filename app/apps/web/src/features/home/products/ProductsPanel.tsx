import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { Product, ProductAccessIssues } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, StatusView } from '../../../components/layout/index.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { DataValue, EntryDate, PublishedStatus } from '../../../theme.js';

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
      <Typography variant="overline" component="h3">
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
        <Typography variant="h2" component="h2">
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
          {product.published ? <PublishedStatus>{t.products.published}</PublishedStatus> : t.products.draft} ·{' '}
          <DataValue>{accessCount}</DataValue> {t.products.accessItemNoun({ count: accessCount })}
        </span>
        <EntryDate component="time" dateTime={product.createdAt}>
          {formatDate(product.createdAt, language)}
        </EntryDate>
      </Stack>
      {issue ? <AccessIssues issue={issue} /> : null}
      <Box>
        <Button
          size="small"
          variant="text"
          component="a"
          href={`/panel/products/${encodeURIComponent(product.id)}`}
        >
          {t.products.manage}
        </Button>
      </Box>
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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const query = useDebouncedValue(search);

  const visibleProducts = (products.data?.products ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((product) => matchesQuery(query, product.title))
    .filter((product) => statusFilter === 'all' || (statusFilter === 'published' ? product.published : !product.published));
  const paged = usePagedList(visibleProducts, `${query}|${statusFilter}`);
  const filterLabels = {
    all: t.products.filterAll,
    published: t.products.filterPublished,
    draft: t.products.filterDraft,
  } as const;

  return (
    <PanelPage
      title={t.sections.products}
      action={<Button component={Link} to="/panel/products/new" variant="contained">+ {t.common.add}</Button>}
    >
      <ListSection
        toolbar={{
          search: (
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.products.searchPlaceholder}
            testId="products-search"
          />
          ),
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.products.statusFilterAria}>
              {(['all', 'published', 'draft'] as const).map((value) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  variant={statusFilter === value ? 'filled' : 'outlined'}
                  color={statusFilter === value ? 'primary' : 'default'}
                  label={filterLabels[value]}
                  aria-pressed={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                />
              ))}
            </Stack>
          ),
        }}
        pagination={products.isSuccess && visibleProducts.length > 0 ? <ListPagination paged={paged} testId="products-pagination" /> : undefined}
        isEmpty={products.isSuccess && products.data.products.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.products.empty, action: <Button component={Link} to="/panel/products/new">+ {t.common.add}</Button> }} />}
        noMatches={products.isSuccess && products.data.products.length > 0 && visibleProducts.length === 0 ? <Typography variant="body1">{t.products.noMatches}</Typography> : undefined}
      >
        {products.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.products.loading }} />
        ) : products.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(products.error, t) }} />
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
      </ListSection>
    </PanelPage>
  );
};
