import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  OutlinedInput,
  Snackbar,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { Product, ProductAccessIssues, StaffSpace } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, StatusView } from '../../../components/layout/index.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate, formatPrice } from '../../../lib/format.js';
import { DataValue, EntryDate, PublishedStatus } from '../../../theme.js';
import { productTypeLabel } from './product-type.js';

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
  spaces,
  spacesPending,
  spacesError,
}: {
  product: Product;
  issue?: ProductAccessIssues | undefined;
  spaces: StaffSpace[];
  spacesPending: boolean;
  spacesError: boolean;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [copyFallbackUrl, setCopyFallbackUrl] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'publish' | 'unpublish' | null>(null);
  const prices = useQuery({ ...actions.productPrices(product.id), enabled: !product.published });
  const downloads = useQuery({
    ...actions.productDownloadAssets(product.id),
    enabled: !product.published && product.type === 'digital_download',
  });

  const publishProduct = useMutation({
    ...actions.publishProduct,
    onSuccess: async () => {
      setConfirmation(null);
      await Promise.all([
        queryClient.invalidateQueries(actions.productsInvalidates()),
        queryClient.invalidateQueries(actions.publicOfferInvalidates()),
      ]);
    },
  });
  const unpublishProduct = useMutation({
    ...actions.unpublishProduct,
    onSuccess: async () => {
      setConfirmation(null);
      await Promise.all([
        queryClient.invalidateQueries(actions.productsInvalidates()),
        queryClient.invalidateQueries(actions.publicOfferInvalidates()),
      ]);
    },
  });

  const accessCount = product.accessItems.length;
  const activePrice = prices.data?.prices.find((price) => price.active);
  const hasGatedSpace = spaces.some(
    (space) => space.visibility === 'product' && space.productIds.includes(product.id),
  );
  const hasReadyDownload = downloads.data?.assets.some((asset) => asset.status === 'ready') ?? false;
  const hasDelivery = accessCount > 0 || hasGatedSpace || hasReadyDownload;
  const deliveryPending = !hasDelivery
    && (spacesPending || (product.type === 'digital_download' && downloads.isPending));
  const deliveryError = !hasDelivery
    && !deliveryPending
    && (spacesError || (product.type === 'digital_download' && downloads.isError));
  const checkoutUrl = `${window.location.origin}/checkout/${product.id}`;
  const publishBlockers = product.published
    ? []
    : [
        ...(hasDelivery
          ? []
          : deliveryPending
            ? [t.products.publishCheckingDelivery]
            : deliveryError
              ? [t.products.publishDeliveryUnavailable]
              : [t.products.publishNeedsDelivery]),
        ...(prices.isPending
          ? [t.products.publishCheckingPrice]
          : prices.isError
            ? [t.products.publishPriceUnavailable]
            : activePrice === undefined
              ? [t.products.publishNeedsActivePrice]
              : []),
      ];

  const copyCheckoutLink = async () => {
    if (navigator.clipboard === undefined) {
      setCopied(false);
      setCopyFallbackUrl(checkoutUrl);
      return;
    }
    try {
      await navigator.clipboard.writeText(checkoutUrl);
      setCopyFallbackUrl(null);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFallbackUrl(checkoutUrl);
    }
  };

  return (
    <Paper elevation={1} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }} data-testid="product-row">
      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h2" component="h2">
          {product.title}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={productTypeLabel(product.type, t)}
          data-testid={`product-type-${product.id}`}
        />
        {issue ? (
          <Chip size="small" color="warning" variant="outlined" label={t.products.accessIssuesChip} />
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t.products.copyCheckoutLink}>
          <IconButton
            size="small"
            onClick={() => void copyCheckoutLink()}
            aria-label={t.products.copyCheckoutLink}
            data-testid={`copy-checkout-${product.id}`}
          >
            <CopyLinkGlyph />
          </IconButton>
        </Tooltip>
        {product.published ? (
          <Button
            variant="text"
            color="error"
            disabled={unpublishProduct.isPending}
            onClick={() => setConfirmation('unpublish')}
          >
            {unpublishProduct.isPending ? t.products.unpublishing : t.products.unpublish}
          </Button>
        ) : (
          <Button
            variant="text"
            disabled={publishProduct.isPending || publishBlockers.length > 0}
            onClick={() => setConfirmation('publish')}
          >
            {publishProduct.isPending ? t.products.publishing : t.products.publish}
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
      {copyFallbackUrl === null ? null : (
        <Stack useFlexGap spacing="0.5rem" data-testid={`copy-fallback-${product.id}`}>
          <Alert severity="warning">{t.products.checkoutLinkCopyFailed}</Alert>
          <FormControl fullWidth>
            <FormLabel htmlFor={`checkout-url-${product.id}`}>{t.products.publishPublicUrl}</FormLabel>
            <OutlinedInput
              id={`checkout-url-${product.id}`}
              value={copyFallbackUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <FormHelperText>{t.products.checkoutLinkManualHint}</FormHelperText>
          </FormControl>
        </Stack>
      )}
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
      {prices.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(prices.error, t), retry: { label: t.common.retry, onRetry: () => void prices.refetch() } }} /> : null}
      {downloads.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(downloads.error, t), retry: { label: t.common.retry, onRetry: () => void downloads.refetch() } }} /> : null}
      {!product.published && publishBlockers.length > 0 ? (
        <Stack useFlexGap spacing="0.25rem" data-testid={`publish-blockers-${product.id}`}>
          {publishBlockers.map((reason) => (
            <Typography key={reason} variant="body2" color="error">
              {reason}
            </Typography>
          ))}
        </Stack>
      ) : null}
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
        <Alert severity="error">{localizeError(publishProduct.error, t)}</Alert>
      ) : null}
      {unpublishProduct.isError ? (
        <Alert severity="error">{localizeError(unpublishProduct.error, t)}</Alert>
      ) : null}
      <ConfirmDialog
        open={confirmation === 'publish'}
        title={t.products.publishConfirmTitle}
        body={(
          <Stack useFlexGap spacing="0.75rem">
            <Typography>{t.products.publishConfirmIntro}</Typography>
            <FormControl fullWidth>
              <FormLabel htmlFor={`publish-url-${product.id}`}>{t.products.publishPublicUrl}</FormLabel>
              <OutlinedInput id={`publish-url-${product.id}`} value={checkoutUrl} readOnly />
            </FormControl>
            <Typography>
              {t.products.publishActivePrice}:{' '}
              <DataValue>
                {activePrice === undefined
                  ? '—'
                  : formatPrice(activePrice.amountCents, activePrice.currency, language)}
              </DataValue>
            </Typography>
          </Stack>
        )}
        cancelLabel={t.common.cancel}
        confirmLabel={publishProduct.isPending ? t.products.publishing : t.products.publishConfirm}
        pending={publishProduct.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => publishProduct.mutate({ id: product.id })}
      />
      <ConfirmDialog
        open={confirmation === 'unpublish'}
        title={t.products.unpublishConfirmTitle}
        body={t.products.unpublishConfirmBody}
        cancelLabel={t.common.cancel}
        confirmLabel={unpublishProduct.isPending ? t.products.unpublishing : t.products.unpublishConfirm}
        pending={unpublishProduct.isPending}
        onClose={() => setConfirmation(null)}
        onConfirm={() => unpublishProduct.mutate({ id: product.id })}
      />
    </Paper>
  );
};

export const ProductsPanel = () => {
  const t = useTranslations();
  const products = useQuery(actions.products);
  const accessIssues = useQuery(actions.productAccessIssues);
  const spaces = useQuery({
    ...actions.staffSpaces,
    enabled: products.data?.products.some((product) => !product.published) ?? false,
  });
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
      {accessIssues.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(accessIssues.error, t), retry: { label: t.common.retry, onRetry: () => void accessIssues.refetch() } }} /> : null}
      {spaces.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }} /> : null}
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
          <StatusView state={{ kind: 'error', message: localizeError(products.error, t), retry: { label: t.common.retry, onRetry: () => void products.refetch() } }} />
        ) : (
          <Stack useFlexGap spacing="1rem">
            {paged.pageItems.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                issue={accessIssues.data?.issues.find((entry) => entry.productId === product.id)}
                spaces={spaces.data?.spaces ?? []}
                spacesPending={spaces.isPending}
                spacesError={spaces.isError}
              />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};
