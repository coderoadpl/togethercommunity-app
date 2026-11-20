import { useId, useState, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import {
  CheckoutBreakdownList,
  CheckoutInlineToggle,
  CheckoutPayBarSurface,
  CheckoutRowButton,
  CheckoutStepItem,
  CheckoutStepList,
  CHECKOUT_PAY_BAR_CLASS,
  CheckoutStepNumber,
  CheckoutSummarySurface,
  CheckoutSummaryText,
  CheckoutSummaryTotal,
  EmberCtaButton,
  FinePrint,
  FOCUS_CARD_INLINE_PADDING,
} from '../../theme.js';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './account-icons.js';

export const CLOSES_ON_ESCAPE_SELECTOR = '[data-closes-on-escape]';
export const closesOnEscape = { 'data-closes-on-escape': true } as const;

export const CheckoutSteps = ({ label, steps, current }: { label: string; steps: readonly string[]; current: number }) => (
  <CheckoutStepList aria-label={label} data-testid="checkout-steps">
    {steps.map((step, index) => (
      <CheckoutStepItem key={step} current={index === current} aria-current={index === current ? 'step' : undefined}>
        <CheckoutStepNumber current={index === current} aria-hidden="true">{index + 1}</CheckoutStepNumber>
        {step}
      </CheckoutStepItem>
    ))}
  </CheckoutStepList>
);

export const CheckoutSummaryRow = ({ items, total, detailsLabel, detailsShortLabel, children }: {
  items: string;
  total: string;
  detailsLabel: string;
  detailsShortLabel: string;
  children?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <CheckoutSummarySurface data-testid="checkout-summary" {...closesOnEscape} sx={{ px: '0.875rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: '0.75rem' }}>
        <CheckoutSummaryText component="p" sx={{ py: '0.625rem' }}>
          {items}{' · '}<CheckoutSummaryTotal aria-live="polite" aria-atomic="true" data-testid="checkout-summary-total">{total}</CheckoutSummaryTotal>
        </CheckoutSummaryText>
        {children == null ? null : (
          <CheckoutInlineToggle
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={detailsLabel}
            onClick={() => setOpen((current) => !current)}
          >
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{detailsShortLabel}</Box>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{detailsLabel}</Box>
            <ChevronDownIcon />
          </CheckoutInlineToggle>
        )}
      </Box>
      {children == null ? null : (
        <Box id={panelId} hidden={!open} sx={{ pt: '0.25rem', pb: '1rem' }}>
          {children}
        </Box>
      )}
    </CheckoutSummarySurface>
  );
};

export type CheckoutPriceLine = { label: string; amount: string; testId: string };

export const CheckoutPriceBreakdown = ({ lines, total }: { lines: readonly CheckoutPriceLine[]; total: CheckoutPriceLine }) => (
  <CheckoutBreakdownList data-testid="checkout-price-breakdown">
    {[...lines, total].map((line) => (
      <Box key={line.testId} sx={{ display: 'contents' }} data-testid={line.testId}>
        <dt>{line.label}</dt>
        <dd>{line.amount}</dd>
      </Box>
    ))}
  </CheckoutBreakdownList>
);

export const CheckoutDisclosureRow = ({ label, open, onToggle, disabled = false, collapseOnEscape = true, testId, after, children }: {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  collapseOnEscape?: boolean;
  testId?: string;
  after?: ReactNode;
  children: ReactNode;
}) => {
  const panelId = useId();
  return (
    <Box {...(collapseOnEscape ? closesOnEscape : {})}>
      <CheckoutRowButton
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={onToggle}
        data-testid={testId}
      >
        <span>{label}</span>
        {open ? <MinusIcon /> : <PlusIcon />}
      </CheckoutRowButton>
      {after}
      <Box id={panelId} hidden={!open} sx={{ pt: '0.375rem', pb: '1rem' }}>
        {open ? children : null}
      </Box>
    </Box>
  );
};

export const CheckoutPayBar = ({ label, disabled, reason, note, messages, testId }: {
  label: ReactNode;
  disabled: boolean;
  reason?: ReactNode;
  note?: ReactNode;
  messages?: ReactNode;
  testId?: string;
}) => {
  const reasonId = useId();
  const noteId = useId();
  const describedBy = [reason == null ? null : reasonId, note == null ? null : noteId].filter((id) => id !== null).join(' ');
  return (
    <CheckoutPayBarSurface
      className={CHECKOUT_PAY_BAR_CLASS}
      data-testid="checkout-pay-bar"
      sx={{ position: 'sticky', bottom: 0, zIndex: 2, mx: `calc(-1 * ${FOCUS_CARD_INLINE_PADDING})`, px: FOCUS_CARD_INLINE_PADDING, pt: '0.875rem', pb: '0.875rem' }}
    >
      <Stack useFlexGap spacing="0.5rem">
        {messages}
        <Box>
          <EmberCtaButton
            type="submit"
            variant="contained"
            fullWidth
            disabled={disabled}
            data-testid={testId}
            aria-describedby={describedBy === '' ? undefined : describedBy}
          >
            {label}
          </EmberCtaButton>
          <Typography
            id={reasonId}
            role="status"
            variant="body2"
            color="text.secondary"
            data-testid="checkout-pay-reason"
            sx={{ mt: reason == null ? 0 : '0.5rem' }}
          >
            {reason}
          </Typography>
        </Box>
        {note == null ? null : (
          <FinePrint id={noteId} component="p" variant="caption" color="text.secondary" data-testid="checkout-next-step">{note}</FinePrint>
        )}
      </Stack>
    </CheckoutPayBarSurface>
  );
};
