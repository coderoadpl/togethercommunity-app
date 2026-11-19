import { useId, useState, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import {
  CheckoutInlineToggle,
  CheckoutPayBarSurface,
  CheckoutRowButton,
  CheckoutStepItem,
  CheckoutStepList,
  CheckoutStepNumber,
  CheckoutSummarySurface,
  CheckoutSummaryTotal,
  EmberCtaButton,
  FinePrint,
} from '../../theme.js';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './account-icons.js';

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

export const CheckoutSummaryRow = ({ items, total, detailsLabel, children }: {
  items: string;
  total: string;
  detailsLabel: string;
  children?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <CheckoutSummarySurface data-testid="checkout-summary" sx={{ px: '0.875rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: '0.75rem' }}>
        <Typography component="p" sx={{ py: '0.625rem' }}>
          {items}{' · '}<CheckoutSummaryTotal aria-live="polite" aria-atomic="true" data-testid="checkout-summary-total">{total}</CheckoutSummaryTotal>
        </Typography>
        {children == null ? null : (
          <CheckoutInlineToggle
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            {detailsLabel}
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

export const CheckoutDisclosureRow = ({ label, open, onToggle, disabled = false, testId, after, children }: {
  label: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testId?: string;
  after?: ReactNode;
  children: ReactNode;
}) => {
  const panelId = useId();
  return (
    <Box>
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
      <Box id={panelId} hidden={!open} sx={{ pb: '1rem' }}>
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
      data-testid="checkout-pay-bar"
      sx={{ position: 'sticky', bottom: 0, zIndex: 2, mx: '-1.8rem', px: '1.8rem', pt: '0.875rem', pb: '0.875rem' }}
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
