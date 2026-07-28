import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  InputLabel,
  Link,
  LinearProgress,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type {
  CouponAppliesTo,
  CouponKind,
  CouponRecurringDuration,
  CouponStatsCursor,
  CouponStatsItem,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import {
  ListSection,
  PanelPage,
  ResponsiveTable,
  SectionCard,
  StatusView,
} from '../../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate, formatPrice } from '../../../lib/format.js';

const totals = (
  values: Array<{ currency: string; amountCents: number }>,
  language: 'pl' | 'en',
): string =>
  values.length === 0
    ? '—'
    : values.map((value) => formatPrice(value.amountCents, value.currency, language)).join(' · ');

const couponValue = (
  coupon: CouponStatsItem['coupon'],
  language: 'pl' | 'en',
): string =>
  coupon.kind === 'percent'
    ? `${coupon.value}%`
    : formatPrice(coupon.value, coupon.currency ?? 'PLN', language);

const optionalPositiveInteger = (value: string): number | null =>
  value.trim() === '' ? null : Number.parseInt(value, 10);

const optionalDate = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString();

const downloadFile = (file: { filename: string; mimeType: string; content: string }) => {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const CouponsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [partnerLabel, setPartnerLabel] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<CouponStatsCursor | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<CouponStatsCursor | null>>([]);
  const partnerFilter = useDebouncedValue(partnerLabel);
  const filterQuery = partnerFilter === '' ? {} : { partnerLabel: partnerFilter };
  const statsQuery = {
    ...filterQuery,
    ...(cursor === null
      ? {}
      : { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id }),
  };
  const coupons = useQuery(actions.couponStats(statsQuery));

  const download = async (format: 'csv' | 'json') => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await queryClient.fetchQuery(actions.couponStatsExport({ ...filterQuery, format }));
      downloadFile(file);
    } catch (error) {
      setExportError(localizeError(error, t));
    } finally {
      setExporting(null);
    }
  };

  return (
    <PanelPage
      title={t.coupons.title}
      action={<Button href="/panel/sales/coupons/new" variant="contained">{t.coupons.create}</Button>}
      data-testid="coupons-page"
    >
      <ListSection
        isEmpty={coupons.isSuccess && coupons.data.items.length === 0 && partnerFilter === ''}
        empty={(
          <StatusView
            state={{
              kind: 'empty',
              title: t.coupons.empty,
              body: t.coupons.emptyBody,
              action: <Button href="/panel/sales/coupons/new">{t.coupons.create}</Button>,
            }}
          />
        )}
        noMatches={
          coupons.isSuccess && coupons.data.items.length === 0
            ? <Typography>{t.coupons.noMatches}</Typography>
            : undefined
        }
        toolbar={{
          search: (
            <SearchField
              value={partnerLabel}
              onChange={(value) => {
                setPartnerLabel(value);
                setCursor(null);
                setPreviousCursors([]);
              }}
              placeholder={t.coupons.partnerFilter}
              testId="coupon-partner-filter"
            />
          ),
          actions: (
            <Stack direction="row" useFlexGap spacing="0.5rem">
              <Button
                variant="outlined"
                disabled={exporting !== null}
                onClick={() => void download('csv')}
                data-testid="coupons-export-csv"
              >
                {exporting === 'csv' ? t.coupons.exporting : t.coupons.exportCsv}
              </Button>
              <Button
                variant="outlined"
                disabled={exporting !== null}
                onClick={() => void download('json')}
                data-testid="coupons-export-json"
              >
                {exporting === 'json' ? t.coupons.exporting : t.coupons.exportJson}
              </Button>
            </Stack>
          ),
        }}
      >
        {coupons.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.coupons.loading }} />
        ) : coupons.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(coupons.error, t) }} />
        ) : (
          <ResponsiveTable>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t.coupons.code}</TableCell>
                  <TableCell>{t.coupons.kindValue}</TableCell>
                  <TableCell>{t.coupons.scope}</TableCell>
                  <TableCell>{t.coupons.partner}</TableCell>
                  <TableCell>{t.coupons.status}</TableCell>
                  <TableCell>{t.coupons.redemptions}</TableCell>
                  <TableCell>{t.coupons.gross}</TableCell>
                  <TableCell>{t.coupons.discount}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {coupons.data.items.map((item) => (
                  <TableRow
                    key={item.coupon.id}
                    hover
                    data-testid="coupon-row"
                  >
                    <TableCell>
                      <Link href={`/panel/sales/coupons/${item.coupon.id}`}>
                        {item.coupon.code}
                      </Link>
                    </TableCell>
                    <TableCell>{couponValue(item.coupon, language)}</TableCell>
                    <TableCell>
                      {item.coupon.scope.kind === 'all'
                        ? t.coupons.allProducts
                        : t.coupons.selectedProducts}
                    </TableCell>
                    <TableCell>{item.coupon.partnerLabel ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={item.coupon.status === 'active' ? 'success' : 'default'}
                        label={
                          item.coupon.status === 'active'
                            ? t.coupons.active
                            : t.coupons.archived
                        }
                      />
                    </TableCell>
                    <TableCell>{item.redemptions}</TableCell>
                    <TableCell>{totals(item.grossAttributed, language)}</TableCell>
                    <TableCell>{totals(item.discountGiven, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
        )}
        {coupons.isSuccess ? (
          <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ justifyContent: 'flex-end' }}>
            <Button
              disabled={previousCursors.length === 0}
              onClick={() => {
                const previous = previousCursors.at(-1) ?? null;
                setPreviousCursors((current) => current.slice(0, -1));
                setCursor(previous);
              }}
            >
              {t.coupons.previousPage}
            </Button>
            <Button
              disabled={coupons.data.nextCursor === null}
              onClick={() => {
                if (coupons.data.nextCursor === null) return;
                setPreviousCursors((current) => [...current, cursor]);
                setCursor(coupons.data.nextCursor);
              }}
            >
              {t.coupons.nextPage}
            </Button>
          </Stack>
        ) : null}
      </ListSection>
      {exportError === null ? null : <Alert severity="error">{exportError}</Alert>}
    </PanelPage>
  );
};

export const CouponCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const products = useQuery(actions.products);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<CouponKind>('percent');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('PLN');
  const [scopeKind, setScopeKind] = useState<'all' | 'products'>('all');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [appliesTo, setAppliesTo] = useState<CouponAppliesTo>('both');
  const [recurringDuration, setRecurringDuration] =
    useState<CouponRecurringDuration>('first_invoice');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [maxPerMember, setMaxPerMember] = useState('');
  const [partnerLabel, setPartnerLabel] = useState('');

  const create = useMutation({
    ...actions.createCoupon,
    onSuccess: async ({ coupon }) => {
      await queryClient.invalidateQueries(actions.couponsInvalidates());
      await navigate({
        to: '/panel/sales/coupons/$couponId',
        params: { couponId: coupon.id },
      });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      code,
      kind,
      value: Number.parseInt(value, 10),
      currency: kind === 'amount' ? currency.trim().toUpperCase() : null,
      scope: scopeKind === 'all' ? { kind: 'all' } : { kind: 'products', productIds },
      appliesTo,
      recurringDuration,
      startsAt: optionalDate(startsAt),
      endsAt: optionalDate(endsAt),
      maxRedemptions: optionalPositiveInteger(maxRedemptions),
      maxRedemptionsPerMember: optionalPositiveInteger(maxPerMember),
      partnerLabel: partnerLabel.trim() === '' ? null : partnerLabel,
    });
  };

  return (
    <PanelPage
      title={t.coupons.createTitle}
      backTo={{ label: t.coupons.allCoupons, href: '/panel/sales/coupons' }}
    >
      <SectionCard title={t.coupons.createTitle} onSubmit={submit}>
        <FormControl fullWidth>
          <FormLabel htmlFor="coupon-code">{t.coupons.code}</FormLabel>
          <OutlinedInput
            id="coupon-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <InputLabel id="coupon-kind-label">{t.coupons.kindValue}</InputLabel>
            <Select
              labelId="coupon-kind-label"
              label={t.coupons.kindValue}
              value={kind}
              onChange={(event) => setKind(event.target.value === 'amount' ? 'amount' : 'percent')}
            >
              <MenuItem value="percent">{t.coupons.percent}</MenuItem>
              <MenuItem value="amount">{t.coupons.amount}</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-value">
              {kind === 'percent' ? t.coupons.valuePercent : t.coupons.valueCents}
            </FormLabel>
            <OutlinedInput
              id="coupon-value"
              type="number"
              inputProps={{ min: 0, max: kind === 'percent' ? 100 : undefined, step: 1 }}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
            />
          </FormControl>
        </Stack>
        {kind === 'amount' ? (
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-currency">{t.coupons.currency}</FormLabel>
            <OutlinedInput
              id="coupon-currency"
              value={currency}
              inputProps={{ maxLength: 3 }}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              required
            />
          </FormControl>
        ) : null}
        <FormControl fullWidth>
          <InputLabel id="coupon-scope-label">{t.coupons.scope}</InputLabel>
          <Select
            labelId="coupon-scope-label"
            label={t.coupons.scope}
            value={scopeKind}
            onChange={(event) => setScopeKind(event.target.value === 'products' ? 'products' : 'all')}
          >
            <MenuItem value="all">{t.coupons.allProducts}</MenuItem>
            <MenuItem value="products">{t.coupons.selectedProducts}</MenuItem>
          </Select>
        </FormControl>
        {scopeKind === 'products' ? (
          <FormControl fullWidth>
            <InputLabel id="coupon-products-label">{t.coupons.products}</InputLabel>
            <Select
              multiple
              labelId="coupon-products-label"
              label={t.coupons.products}
              value={productIds}
              onChange={(event) => {
                const next = event.target.value;
                setProductIds(typeof next === 'string' ? next.split(',') : next);
              }}
            >
              {(products.data?.products ?? []).map((product) => (
                <MenuItem key={product.id} value={product.id}>{product.title}</MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        <FormControl fullWidth>
          <InputLabel id="coupon-applies-label">{t.coupons.appliesTo}</InputLabel>
          <Select
            labelId="coupon-applies-label"
            label={t.coupons.appliesTo}
            value={appliesTo}
            onChange={(event) => {
              const next = event.target.value;
              setAppliesTo(next === 'one_time' || next === 'recurring' ? next : 'both');
            }}
          >
            <MenuItem value="one_time">{t.coupons.oneTime}</MenuItem>
            <MenuItem value="recurring">{t.coupons.recurring}</MenuItem>
            <MenuItem value="both">{t.coupons.both}</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel id="coupon-duration-label">{t.coupons.recurringDuration}</InputLabel>
          <Select
            labelId="coupon-duration-label"
            label={t.coupons.recurringDuration}
            value={recurringDuration}
            onChange={(event) =>
              setRecurringDuration(event.target.value === 'forever' ? 'forever' : 'first_invoice')}
          >
            <MenuItem value="first_invoice">{t.coupons.firstInvoice}</MenuItem>
            <MenuItem value="forever">{t.coupons.forever}</MenuItem>
          </Select>
        </FormControl>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-start">{t.coupons.startsAt}</FormLabel>
            <OutlinedInput
              id="coupon-start"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-end">{t.coupons.endsAt}</FormLabel>
            <OutlinedInput
              id="coupon-end"
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </FormControl>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-limit">{t.coupons.maxRedemptions}</FormLabel>
            <OutlinedInput
              id="coupon-limit"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              placeholder={t.coupons.optional}
              value={maxRedemptions}
              onChange={(event) => setMaxRedemptions(event.target.value)}
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="coupon-member-limit">{t.coupons.maxPerMember}</FormLabel>
            <OutlinedInput
              id="coupon-member-limit"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              placeholder={t.coupons.optional}
              value={maxPerMember}
              onChange={(event) => setMaxPerMember(event.target.value)}
            />
          </FormControl>
        </Stack>
        <FormControl fullWidth>
          <FormLabel htmlFor="coupon-partner">{t.coupons.partner}</FormLabel>
          <OutlinedInput
            id="coupon-partner"
            value={partnerLabel}
            placeholder={t.coupons.optional}
            onChange={(event) => setPartnerLabel(event.target.value)}
          />
        </FormControl>
        <Button
          type="submit"
          variant="contained"
          disabled={
            create.isPending ||
            value === '' ||
            (scopeKind === 'products' && productIds.length === 0)
          }
        >
          {create.isPending ? t.coupons.creating : t.coupons.create}
        </Button>
        {create.isError ? <Alert severity="error">{localizeError(create.error, t)}</Alert> : null}
      </SectionCard>
    </PanelPage>
  );
};

export const CouponDetailPage = ({ couponId }: { couponId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const detail = useQuery(actions.couponStatsDetail(couponId));
  const archive = useMutation({
    ...actions.archiveCoupon,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.couponsInvalidates());
    },
  });

  if (detail.isPending) {
    return <PanelPage title={t.coupons.title} state={{ kind: 'loading', label: t.coupons.loading }} />;
  }
  if (detail.isError) {
    return (
      <PanelPage
        title={t.coupons.title}
        state={{ kind: 'error', message: localizeError(detail.error, t) }}
      />
    );
  }

  const item = detail.data.item;
  const maximum = Math.max(1, ...item.timeSeries.map((point) => point.redemptions));

  return (
    <PanelPage
      title={t.coupons.detailTitle({ code: item.coupon.code })}
      backTo={{ label: t.coupons.allCoupons, href: '/panel/sales/coupons' }}
      action={
        item.coupon.status === 'archived' ? null : (
          <Button
            variant="outlined"
            color="error"
            disabled={archive.isPending}
            onClick={() => archive.mutate({ id: item.coupon.id })}
          >
            {archive.isPending ? t.coupons.archiving : t.coupons.archive}
          </Button>
        )
      }
    >
      <Stack direction={{ xs: 'column', md: 'row' }} useFlexGap spacing="1rem">
        {[
          [t.coupons.redemptions, String(item.redemptions)],
          [t.coupons.gross, totals(item.grossAttributed, language)],
          [t.coupons.discount, totals(item.discountGiven, language)],
          [t.coupons.conversion, `${Math.round(item.conversionRate * 1000) / 10}%`],
          [t.coupons.sessions, String(item.sessionsWithCode)],
        ].map(([label, value]) => (
          <Paper key={label} variant="outlined" sx={{ p: '1rem', flex: '1 1 0' }}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="h2">{value}</Typography>
          </Paper>
        ))}
      </Stack>
      <SectionCard title={t.coupons.timeSeries}>
        {item.timeSeries.length === 0 ? (
          <Typography>{t.coupons.noActivity}</Typography>
        ) : (
          <Stack useFlexGap spacing="0.75rem">
            {item.timeSeries.map((point) => (
              <Box key={`${point.date}-${point.currency}`}>
                <Stack
                  direction="row"
                  useFlexGap
                  spacing="1rem"
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography>{formatDate(`${point.date}T00:00:00.000Z`, language)}</Typography>
                  <Typography>{point.redemptions}</Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(4, (point.redemptions / maximum) * 100)}
                  sx={{ mt: '0.25rem' }}
                />
              </Box>
            ))}
          </Stack>
        )}
      </SectionCard>
      {archive.isError ? <Alert severity="error">{localizeError(archive.error, t)}</Alert> : null}
    </PanelPage>
  );
};
