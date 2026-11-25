import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  OutlinedInput,
  Paper,
  Stack,
  SvgIcon,
  Switch,
  Typography,
} from '@mui/material';

import { CART_CURRENCY_MISMATCH_MESSAGE, FREE_ORDER_DELIVERY_UNAVAILABLE, PICKUP_POINT_REJECTION_MESSAGES, PICKUP_POINT_REJECTION_REASONS, pickupPointRejectionReason, type BillingData, type CouponCheckoutBreakdown } from '#core/domain/index.js';
import { ApiError } from '#core/client/index.js';

import { localizeError, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CheckoutDisclosureButton, FinePrint } from '../../theme.js';
import { rowAction } from './checkout-keys.js';

type Translations = ReturnType<typeof useTranslations>;
type InvoiceField = { id: string; label: string; value: string; setValue: (value: string) => void; autoComplete?: string };

const DisclosureIcon = ({ expanded }: { expanded: boolean }) => (
  <SvgIcon fontSize="small" aria-hidden>
    <path d={expanded ? 'M5 11h14v2H5z' : 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'} />
  </SvgIcon>
);

export const completeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const COUPON_EMAIL_REQUIRED_MESSAGE = 'An email is required to validate this coupon';

const couponError = (error: unknown, t: Translations, row: boolean): string => {
  if (!(error instanceof ApiError)) return localizeError(error, t);
  switch (error.appError.message) {
    case 'Coupon cannot be applied':
      return t.checkout.couponUnavailable;
    case COUPON_EMAIL_REQUIRED_MESSAGE:
      return row ? t.checkout.couponEmailRequiredFullPrice : t.checkout.couponEmailRequired;
    default:
      return localizeError(error, t);
  }
};

export const couponNeedsEmail = (error: unknown): boolean =>
  error instanceof ApiError && error.appError.message === COUPON_EMAIL_REQUIRED_MESSAGE;

export const checkoutRefusal = (message: string, t: Translations): string | null => {
  const lockerReason = PICKUP_POINT_REJECTION_REASONS.find((reason) => PICKUP_POINT_REJECTION_MESSAGES[reason] === message);
  if (lockerReason !== undefined) return t.shipping.lockerRejected[lockerReason];
  switch (message) {
    case FREE_ORDER_DELIVERY_UNAVAILABLE:
      return t.shipping.freeOrderUnavailable;
    case CART_CURRENCY_MISMATCH_MESSAGE:
      return t.checkout.cartCurrencyMismatch;
    default:
      return null;
  }
};

export const lockerRefusalError = (error: unknown): boolean =>
  error instanceof ApiError && (error.appError.code === 'locker_phone_invalid' || pickupPointRejectionReason(error.appError.details) !== null);

export const checkoutSessionError = (error: unknown, t: Translations): string =>
  (error instanceof ApiError ? checkoutRefusal(error.appError.message, t) : null) ?? localizeError(error, t);

export const useInvoiceFields = () => {
  const t = useTranslations();
  const [visible, setVisible] = useState(false);
  const [nip, setNip] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('PL');
  const fields = {
    nip: { id: 'checkout-nip', label: t.checkout.nipLabel, value: nip, setValue: setNip },
    company: { id: 'checkout-company', label: t.checkout.companyNameLabel, value: companyName, setValue: setCompanyName, autoComplete: 'organization' },
    address: { id: 'checkout-address', label: t.checkout.addressLabel, value: billingAddress, setValue: setBillingAddress, autoComplete: 'street-address' },
    postalCode: { id: 'checkout-postal-code', label: t.checkout.postalCodeLabel, value: postalCode, setValue: setPostalCode, autoComplete: 'postal-code' },
    city: { id: 'checkout-city', label: t.checkout.cityLabel, value: city, setValue: setCity, autoComplete: 'address-level2' },
    country: { id: 'checkout-country', label: t.checkout.countryLabel, value: country, setValue: setCountry, autoComplete: 'country' },
  } satisfies Record<string, InvoiceField>;
  const billing: { billing?: BillingData } = visible
    ? { billing: { nip: nip === '' ? null : nip, companyName, address: billingAddress, postalCode, city, country } }
    : {};
  return { visible, toggle: () => setVisible((current) => !current), fields, billing };
};

export const InvoiceFields = ({ invoice }: { invoice: ReturnType<typeof useInvoiceFields> }) => {
  const t = useTranslations();
  return (
    <>
      <CheckoutDisclosureButton
        type="button"
        variant="text"
        size="small"
        color="primary"
        startIcon={<DisclosureIcon expanded={invoice.visible} />}
        onClick={invoice.toggle}
        aria-expanded={invoice.visible}
        sx={{ alignSelf: 'flex-start' }}
      >
        {t.checkout.invoiceReveal}
      </CheckoutDisclosureButton>
      {invoice.visible ? <InvoiceInputs invoice={invoice} /> : null}
    </>
  );
};

const InvoiceInput = ({ field, required = true, inputProps }: {
  field: InvoiceField;
  required?: boolean;
  inputProps?: { inputMode: 'numeric'; pattern: string };
}) => (
  <FormControl fullWidth>
    <FormLabel htmlFor={field.id}>{field.label}</FormLabel>
    <OutlinedInput
      id={field.id}
      value={field.value}
      onChange={(event) => field.setValue(event.target.value)}
      required={required}
      autoComplete={field.autoComplete}
      inputProps={inputProps}
    />
  </FormControl>
);

export const InvoiceInputs = ({ invoice }: { invoice: ReturnType<typeof useInvoiceFields> }) => {
  const { fields } = invoice;
  return (
    <Stack useFlexGap spacing="0.75rem">
      <InvoiceInput field={fields.nip} required={false} inputProps={{ inputMode: 'numeric', pattern: '[0-9]{10}' }} />
      <InvoiceInput field={fields.company} />
      <InvoiceInput field={fields.address} />
      <Box data-testid="checkout-invoice-locality" sx={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, 2fr)' } }}>
        <InvoiceInput field={fields.postalCode} />
        <InvoiceInput field={fields.city} />
      </Box>
      <InvoiceInput field={fields.country} />
    </Stack>
  );
};

export const StripeTestModeControls = ({ testConfigured, testEnabled, disabled, onChange, error }: {
  testConfigured: boolean;
  testEnabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
  error: unknown;
}) => {
  const t = useTranslations();
  return (
    <>
      <FormControlLabel label={t.checkout.stripeTestMode}
        control={<Switch checked={testEnabled} data-testid="checkout-test-mode-switch"
          disabled={disabled}
          onChange={(_event, enabled) => onChange(enabled)} />} />
      {testEnabled ? (
        <Alert severity={testConfigured ? 'info' : 'warning'} data-testid="checkout-test-mode-hint">
          {testConfigured ? t.checkout.testModeHint : t.checkout.testModeUnavailable}
        </Alert>
      ) : null}
      {error === null ? null : <Alert severity="error">{localizeError(error, t)}</Alert>}
    </>
  );
};

type CouponValidation = {
  isPending: boolean;
  data: { breakdown: CouponCheckoutBreakdown; recurringDuration: 'first_invoice' | 'forever' } | undefined;
  error: unknown;
};

type CouponBreakdown = 'full' | 'discount';

export const CouponField = ({ visible, testEnabled, code, onVisibilityChange, onCodeChange, onApply, validation, currency, language, recurring, breakdown = 'full' }: {
  visible: boolean;
  testEnabled: boolean;
  code: string;
  onVisibilityChange: (visible: boolean) => void;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  validation: CouponValidation;
  currency: string;
  language: 'pl' | 'en';
  recurring: boolean;
  breakdown?: CouponBreakdown;
}) => {
  const t = useTranslations();
  return (
    <>
      <CheckoutDisclosureButton
        type="button"
        variant="text"
        size="small"
        color="primary"
        disabled={testEnabled}
        startIcon={<DisclosureIcon expanded={visible} />}
        data-testid="checkout-coupon-reveal"
        onClick={() => onVisibilityChange(!visible)}
        aria-expanded={visible}
        sx={{ alignSelf: 'flex-start' }}
      >
        {t.checkout.couponReveal}
      </CheckoutDisclosureButton>
      {testEnabled ? <CouponTestModeNote /> : null}
      {visible && !testEnabled ? (
        <CouponInputs code={code} onCodeChange={onCodeChange} onApply={onApply} validation={validation} currency={currency} language={language} recurring={recurring}
          breakdown={breakdown} />
      ) : null}
    </>
  );
};

export const CouponTestModeNote = () => {
  const t = useTranslations();
  return (
    <FinePrint component="p" variant="caption" data-testid="checkout-coupon-blocked">
      {t.checkout.testModeCouponBlocked}
    </FinePrint>
  );
};

type CouponRowProps = { variant?: 'standalone' } | { variant: 'row'; onRemove: () => void };

export const CouponInputs = ({ code, onCodeChange, onApply, validation, currency, language, recurring, breakdown = 'full', children, ...rowProps }: {
  code: string;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  validation: CouponValidation;
  currency: string;
  language: 'pl' | 'en';
  recurring: boolean;
  breakdown?: CouponBreakdown;
  children?: ReactNode;
} & CouponRowProps) => {
  const t = useTranslations();
  const emptyReasonId = useId();
  const row = rowProps.variant === 'row' ? rowProps : null;
  const applied = row === null ? undefined : validation.data?.breakdown;
  const emptyReason = row !== null && !validation.isPending && code.trim() === '';
  const focusAfter = useRef<'remove' | 'input' | null>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isApplied = applied !== undefined;
  useEffect(() => {
    const target = isApplied ? (focusAfter.current === 'remove' ? removeRef.current : null) : (focusAfter.current === 'input' ? inputRef.current : null);
    if (target === null) return;
    focusAfter.current = null;
    target.focus();
  }, [isApplied]);
  useEffect(() => {
    if (validation.error !== null) focusAfter.current = null;
  }, [validation.error]);
  const canApply = !validation.isPending && code.trim() !== '';
  const apply = () => {
    focusAfter.current = row === null ? null : 'remove';
    onApply();
  };
  return (
    <Stack
      useFlexGap
      spacing="0.5rem"
      {...rowAction('apply')}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        if (canApply && !isApplied) apply();
      }}
    >
      {applied === undefined ? (
        <FormControl fullWidth>
          <FormLabel htmlFor="checkout-coupon">{t.checkout.couponLabel}</FormLabel>
          <OutlinedInput
            id="checkout-coupon"
            inputRef={inputRef}
            inputProps={{ 'data-testid': 'checkout-coupon-input' }}
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
          />
        </FormControl>
      ) : null}
      {children}
      {row !== null && applied !== undefined ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: '0.75rem' }}>
          <Typography role="status" data-testid="checkout-coupon-applied" sx={{ overflowWrap: 'anywhere' }}>
            {t.checkout.couponAppliedLine({ code: applied.code })}
          </Typography>
          <Button
            ref={removeRef}
            type="button"
            variant="text"
            disableFocusRipple
            data-testid="checkout-coupon-remove"
            aria-label={t.checkout.couponRemoveLabel({ code: applied.code })}
            onClick={() => {
              focusAfter.current = 'input';
              row.onRemove();
            }}
            sx={{ px: 0, minWidth: 0, minHeight: '2.75rem' }}
          >
            {t.checkout.couponRemove}
          </Button>
        </Box>
      ) : (
        <>
          <Button
            type="button"
            variant="outlined"
            disableFocusRipple
            data-testid="checkout-coupon-apply"
            disabled={!canApply}
            aria-describedby={emptyReason ? emptyReasonId : undefined}
            onClick={apply}
          >
            {validation.isPending ? t.checkout.couponApplying : t.checkout.couponApply}
          </Button>
          {emptyReason ? <FormHelperText id={emptyReasonId} sx={{ mx: 0, mt: 0 }}>{t.checkout.couponEmpty}</FormHelperText> : null}
        </>
      )}
      {validation.data === undefined ? null : (
        <Paper variant="outlined" sx={{ p: '0.75rem' }} data-testid="checkout-coupon-breakdown">
          <Stack useFlexGap spacing="0.25rem">
            {breakdown === 'full' ? <Typography>{t.checkout.couponOriginal({
              price: formatPrice(validation.data.breakdown.originalCents, currency, language),
            })}</Typography> : null}
            <Typography>{t.checkout.couponDiscount({
              price: formatPrice(validation.data.breakdown.discountCents, currency, language),
            })}</Typography>
            {breakdown === 'full' ? <Typography data-testid="checkout-coupon-final">
              {t.checkout.couponAfterDiscount({
                price: formatPrice(validation.data.breakdown.finalCents, currency, language),
              })}
            </Typography> : null}
            {!recurring ? null : (
              <Typography>
                {validation.data.recurringDuration === 'forever'
                  ? t.checkout.couponForever
                  : t.checkout.couponFirstInvoice}
              </Typography>
            )}
            <FinePrint component="p" variant="caption">
              {t.checkout.omnibusLowest({
                price: formatPrice(
                  validation.data.breakdown.lowestPriceLast30DaysCents,
                  currency,
                  language,
                ),
              })}
            </FinePrint>
          </Stack>
        </Paper>
      )}
      {validation.error === null ? null : (
        <Alert severity="error" data-testid="checkout-coupon-error">
          {couponError(validation.error, t, row !== null)}
        </Alert>
      )}
    </Stack>
  );
};

export const MarketingConsentFields = ({ consents, selected, onChange }: {
  consents: readonly { definitionId: string; label: string; doubleOptIn: boolean; documentUrl: string | null }[];
  selected: readonly string[];
  onChange: (definitionId: string, checked: boolean) => void;
}) => {
  const t = useTranslations();
  return consents.length > 0 ? (
    <FormControl component="fieldset">
      <FormLabel component="legend">{t.checkout.marketingConsentsLabel}</FormLabel>
      <Stack useFlexGap spacing="0.5rem">
        {consents.map((definition) => (
          <FormControlLabel
            key={definition.definitionId}
            control={(
              <Checkbox
                checked={selected.includes(definition.definitionId)}
                onChange={(event) => onChange(definition.definitionId, event.target.checked)}
              />
            )}
            label={(
              <Stack useFlexGap spacing="0.2rem">
                <Typography>{definition.label}</Typography>
                {definition.documentUrl === null ? null : (
                  <MuiLink href={definition.documentUrl} target="_blank" rel="noreferrer">
                    {t.checkout.marketingConsentDocument}
                  </MuiLink>
                )}
                {definition.doubleOptIn ? (
                  <FinePrint component="span" variant="caption">{t.checkout.marketingConsentDoiHint}</FinePrint>
                ) : null}
              </Stack>
            )}
          />
        ))}
      </Stack>
    </FormControl>
  ) : null;
};
