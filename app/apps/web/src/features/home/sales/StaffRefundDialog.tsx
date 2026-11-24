import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  DialogContent,
  FormControlLabel,
  InputAdornment,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { SALES_LINK_TIME_ZONE, minorUnitsFromDecimal, productLines, type OrderListItem, type StaffRefundPreview } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { errorCodeOf, errorDetailsOf, localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { currencyFractionDigits, formatDate, formatMinorUnitsDecimal, formatMinorUnitsPrice } from '../../../lib/format.js';
import {
  RefundAmountField,
  RefundConsequenceGroup,
  RefundConsequenceIcon,
  RefundConsequenceItem,
  RefundConsequencesPanel,
  RefundConsequenceText,
  RefundDialogActions,
  RefundDialogTitle,
  RefundFieldset,
  RefundFinalNote,
  RefundPlainList,
  RefundSheetDialog,
  RefundSheetHandle,
  WrapAnywhereText,
} from '../../../theme.js';
import { AccessIcon, InvoiceIcon, LockIcon, MailIcon, PackageIcon, RefundIcon, StatusIcon, TestModeIcon, TruckIcon } from './refund-icons.js';

const REASON_MAX_LENGTH = 500;

export const newRefundRequestKey = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `refund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

type AmountCheck =
  | { ok: true; amountCents: number }
  | { ok: false; reason: 'format' | 'not_positive' | 'too_high'; amountCents: number | null };

const checkAmount = (text: string, currency: string, remainderCents: number): AmountCheck => {
  const parsed = minorUnitsFromDecimal(text, currency);
  if (!parsed.ok) return { ok: false, reason: 'format', amountCents: null };
  if (parsed.value <= 0) return { ok: false, reason: 'not_positive', amountCents: null };
  if (parsed.value > remainderCents) return { ok: false, reason: 'too_high', amountCents: parsed.value };
  return { ok: true, amountCents: parsed.value };
};

const amountMessage = (check: AmountCheck, t: Messages, currency: string, remainder: string): string | null => {
  if (check.ok) return null;
  const messages = t.sales.staffRefund;
  if (check.reason === 'too_high') return messages.amountTooHigh({ remainder });
  if (check.reason === 'not_positive') return messages.amountNotPositive({ remainder });
  const decimals = currencyFractionDigits(currency);
  return decimals === 0 ? messages.amountWhole({ remainder }) : messages.amountInvalid({ decimals, remainder });
};

const remainderDetailSchema = z.object({ remainderCents: z.number().int().nonnegative() });

const waitingDetailSchema = z.object({ waitingRefund: z.literal(true) });

const shipmentDetailSchema = z.object({ shipmentState: z.object({ onPackingList: z.boolean(), hasShipmentOrLabel: z.boolean() }) });

const shipmentStateKey = (preview: StaffRefundPreview): string => JSON.stringify([preview.onPackingList, preview.hasShipment, preview.fullRefundOptions]);

const currencySymbol = (currency: string, language: string): string =>
  new Intl.NumberFormat(language, { style: 'currency', currency }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;

const Consequence = ({ icon, children, hint, strong = false }: { icon: ReactNode; children: ReactNode; hint?: ReactNode; strong?: boolean }) => (
  <RefundConsequenceItem>
    <RefundConsequenceIcon>{icon}</RefundConsequenceIcon>
    <Box sx={{ minWidth: 0 }}>
      <RefundConsequenceText variant="body2" strong={strong}>{children}</RefundConsequenceText>
      {hint === undefined ? null : <Typography variant="body2" color="textSecondary">{hint}</Typography>}
    </Box>
  </RefundConsequenceItem>
);

const VariantSlot = ({ active, children }: { active: boolean; children: ReactNode }) => (
  <Box aria-hidden={active ? undefined : true} sx={{ gridArea: '1 / 1', minWidth: 0, visibility: active ? 'visible' : 'hidden' }}>
    {children}
  </Box>
);

const Variants = ({ compact, partial, full, part }: { compact: boolean; partial: boolean; full: ReactNode; part: ReactNode }) => {
  if (compact) return partial ? part : full;
  return (
    <Box sx={{ display: 'grid' }}>
      <VariantSlot active={!partial}>{full}</VariantSlot>
      <VariantSlot active={partial}>{part}</VariantSlot>
    </Box>
  );
};

interface StaffRefundDialogProps {
  open: boolean;
  order: OrderListItem;
  preview: StaffRefundPreview;
  requestKey: string;
  onClose: () => void;
}

export const StaffRefundDialog = ({ open, order, preview, requestKey, onClose }: StaffRefundDialogProps) => {
  const t = useTranslations();
  const messages = t.sales.staffRefund;
  const { language } = useLanguage();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const queryClient = useQueryClient();
  const { currency, remainderCents, fullRefundOptions: options } = preview;
  const money = (cents: number) => formatMinorUnitsPrice(cents, currency, language);
  const remainder = money(remainderCents);
  const returnableUnits = preview.returnableStock.filter((entry) => entry.quantity > 0).map((entry) => {
    const name = order.lines?.find((line) => line.productId === entry.productId)?.name ?? order.productTitle;
    return `${name} × ${String(entry.quantity)}`;
  });
  const restockVisible = options.restockOffered && returnableUnits.length > 0;
  const accessNames = order.lines === undefined
    ? [order.productTitle]
    : productLines(order.lines).filter((line) => line.productType !== 'physical').map((line) => line.name);

  const [partial, setPartial] = useState(false);
  const [amountText, setAmountText] = useState(() => formatMinorUnitsDecimal(remainderCents, currency, language));
  const [amountTouched, setAmountTouched] = useState(false);
  const [restock, setRestock] = useState(restockVisible && options.restockDefault);
  const [removeFromPackingList, setRemoveFromPackingList] = useState(options.removeFromPackingListOffered && options.removeFromPackingListDefault);
  const [reason, setReason] = useState('');
  const [shownShipmentState, setShownShipmentState] = useState(() => shipmentStateKey(preview));
  if (shownShipmentState !== shipmentStateKey(preview)) {
    setShownShipmentState(shipmentStateKey(preview));
    setRestock(restockVisible && options.restockDefault);
    setRemoveFromPackingList(options.removeFromPackingListOffered && options.removeFromPackingListDefault);
  }

  const refund = useMutation({
    ...actions.createOrderRefund,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
      onClose();
    },
    onError: async (error) => {
      if (errorCodeOf(error) === 'conflict') await queryClient.invalidateQueries(actions.ordersInvalidates());
    },
  });

  const pending = refund.isPending;
  const clearSubmitError = () => {
    if (!pending) refund.reset();
  };

  const check: AmountCheck = partial ? checkAmount(amountText, currency, remainderCents) : { ok: true, amountCents: remainderCents };
  const amountError = partial && amountTouched ? amountMessage(check, t, currency, remainder) : null;
  const effectiveCents = check.amountCents;
  const fullAmount = check.ok && check.amountCents === remainderCents;
  const endsAccess = partial && fullAmount && accessNames.length > 0;
  const mayEndLater = partial && !fullAmount && (accessNames.length > 0 || preview.cancelsSubscription)
    ? messages.partialMayEndAccess({ access: accessNames.length > 0, subscription: preview.cancelsSubscription })
    : null;
  const restocking = restockVisible && restock;
  const removingFromPackingList = removeFromPackingList || restocking;

  const submit = () => {
    if (!check.ok) {
      setAmountTouched(true);
      return;
    }
    const note = reason.trim();
    refund.mutate({
      orderId: order.id,
      requestKey,
      ...(partial ? { amountCents: check.amountCents } : { expectedAmountCents: remainderCents }),
      expectedRemainderCents: remainderCents,
      ...(note === '' ? {} : { reason: note }),
      expectedShipmentState: { onPackingList: preview.onPackingList, hasShipmentOrLabel: preview.hasShipment },
      ...(partial
        ? { restock: false, removeFromPackingList: false }
        : {
          ...(options.restockOffered ? { restock: restockVisible && restock } : {}),
          ...(options.removeFromPackingListOffered ? { removeFromPackingList: removingFromPackingList } : {}),
        }),
    });
  };

  const close = () => {
    if (!pending) onClose();
  };

  const conflict = refund.isError && errorCodeOf(refund.error) === 'conflict';
  const changedRemainder = conflict ? remainderDetailSchema.safeParse(errorDetailsOf(refund.error)) : null;
  const changedShipment = conflict && shipmentDetailSchema.safeParse(errorDetailsOf(refund.error)).success;
  const blocked = conflict && changedRemainder?.success !== true && !changedShipment;
  const submitError = (() => {
    if (!refund.isError) return null;
    if (changedRemainder?.success === true) return messages.errorRemainderChanged({ remainder: money(changedRemainder.data.remainderCents) });
    if (changedShipment) return messages.errorShipmentChanged;
    if (conflict) return waitingDetailSchema.safeParse(errorDetailsOf(refund.error)).success ? messages.errorConflict : messages.errorRefused;
    const code = errorCodeOf(refund.error);
    if (code === 'rate_limited') return messages.errorRateLimited;
    if (code === 'validation') {
      const detail = remainderDetailSchema.safeParse(errorDetailsOf(refund.error));
      if (detail.success) return messages.amountTooHigh({ remainder: money(detail.data.remainderCents) });
    }
    return localizePanelError(refund.error, t);
  })();

  const buyer = order.memberName ?? order.memberEmail;
  const testMode = preview.mode === 'test';
  const paidDate = formatDate(order.paidAt ?? order.createdAt, language, SALES_LINK_TIME_ZONE);
  const laterCents = check.ok ? remainderCents - check.amountCents : null;

  const units = returnableUnits.join(', ');
  const fullConsequences = (
    <>
      {restocking && options.removeFromPackingListOffered && removingFromPackingList
        ? <Consequence icon={<PackageIcon />}>{messages.consequenceRestockAndRemove({ units })}</Consequence>
        : (
          <>
            {restocking ? <Consequence icon={<PackageIcon />}>{messages.consequenceRestock({ units })}</Consequence> : null}
            {options.removeFromPackingListOffered
              ? <Consequence icon={<PackageIcon />}>{removingFromPackingList ? messages.consequenceRemoveFromPackingList : messages.consequenceStaysOnPackingList}</Consequence>
              : null}
          </>
        )}
      {preview.hasShipment ? <Consequence icon={<TruckIcon />} hint={messages.consequenceLabelHint}>{messages.consequenceLabel}</Consequence> : null}
      {accessNames.length === 0 ? null : <Consequence icon={<AccessIcon />} hint={accessNames.join(', ')}>{messages.consequenceAccessEnds}</Consequence>}
      {preview.cancelsSubscription ? <Consequence icon={<StatusIcon />}>{messages.consequenceSubscriptionCancelled}</Consequence> : null}
      <Consequence icon={<StatusIcon />}>{messages.consequenceStatusFull}</Consequence>
    </>
  );
  const partialConsequences = (
    <>
      <Consequence icon={<PackageIcon />}>
        {preview.onPackingList ? `${messages.consequenceNoRestock} ${messages.consequenceStaysOnPackingList}` : messages.consequenceNoRestock}
      </Consequence>
      {accessNames.length === 0 ? null : <Consequence icon={<AccessIcon />} hint={accessNames.join(', ')}>{endsAccess ? messages.consequenceAccessEnds : messages.consequenceAccessStays}</Consequence>}
      {preview.cancelsSubscription && fullAmount ? <Consequence icon={<StatusIcon />}>{messages.consequenceSubscriptionCancelled}</Consequence> : null}
      {mayEndLater === null ? null : <Consequence icon={<StatusIcon />}>{mayEndLater}</Consequence>}
      <Consequence
        icon={<StatusIcon />}
        hint={laterCents === null || laterCents <= 0 ? undefined : messages.consequenceLaterRemainder({ amount: money(laterCents) })}
      >
        {fullAmount ? messages.consequenceStatusFull : messages.consequenceStatusPartial}
      </Consequence>
    </>
  );

  const providerConsequence = check.ok
    ? messages.consequenceProvider({ amount: money(check.amountCents) })
    : messages.consequenceProviderCap({ remainder });

  const finalNote = (
    <RefundFinalNote key="note" direction="row" useFlexGap spacing="0.4rem">
      <LockIcon />
      <Typography variant="body2">{messages.footerFinal}</Typography>
    </RefundFinalNote>
  );
  const cancelButton = <Button key="cancel" variant="outlined" onClick={close} disabled={pending}>{blocked ? t.common.close : t.common.cancel}</Button>;
  const submitButton = (
    <Button
      key="submit"
      variant="contained"
      color="primary"
      startIcon={<RefundIcon />}
      disabled={pending || blocked || (partial && !check.ok)}
      onClick={submit}
      data-testid="staff-refund-submit"
    >
      {pending
        ? messages.submitting
        : effectiveCents === null ? messages.submitWithoutAmount : messages.submit({ amount: money(effectiveCents) })}
    </Button>
  );

  return (
    <RefundSheetDialog
      open={open}
      onClose={close}
      fullWidth
      maxWidth="md"
      aria-labelledby={titleId}
      data-testid="staff-refund-dialog"
    >
      <RefundSheetHandle aria-hidden />
      <RefundDialogTitle id={titleId} component="div">
        <Box sx={{ minWidth: 0 }}>
          <WrapAnywhereText variant="h2" component="h2">{messages.dialogTitle({ id: order.id })}</WrapAnywhereText>
          <WrapAnywhereText variant="body2" color="textSecondary" sx={{ mt: '0.25rem' }}>
            {messages.dialogSubtitle({ buyer, paid: money(preview.paidCents), date: paidDate })}
          </WrapAnywhereText>
        </Box>
        <Chip size="small" variant="outlined" label={testMode ? messages.modeTest : messages.modeLive} sx={{ flexShrink: 0 }} />
      </RefundDialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          <Stack useFlexGap spacing="1.25rem" sx={{ p: { xs: '1rem', sm: '1.5rem' } }}>
            <Box>
              <FormControlLabel
                sx={{ alignItems: 'flex-start', m: 0, gap: '0.5rem' }}
                disabled={pending}
                control={<Switch checked={partial} onChange={(_, checked) => { setPartial(checked); setAmountTouched(false); clearSubmitError(); }} data-testid="staff-refund-partial" />}
                label={(
                  <Box sx={{ pt: '0.4rem' }}>
                    <Typography>{messages.partialSwitch}</Typography>
                    <Variants
                      compact={compact}
                      partial={partial}
                      full={<Typography variant="body2" color="textSecondary">{messages.partialOffHint}</Typography>}
                      part={<Typography variant="body2" color="textSecondary">{messages.partialOnHint}</Typography>}
                    />
                  </Box>
                )}
              />
            </Box>
            <RefundAmountField
              locked={!partial}
              label={messages.amountLabel}
              value={partial ? amountText : formatMinorUnitsDecimal(remainderCents, currency, language)}
              disabled={pending}
              onChange={(event) => { setAmountText(event.target.value); setAmountTouched(true); clearSubmitError(); }}
              onBlur={() => setAmountTouched(true)}
              error={amountError !== null}
              helperText={amountError ?? (partial ? messages.amountPartialHelp({ remainder, paid: money(preview.paidCents) }) : messages.amountFullHelp)}
              slotProps={{
                input: { readOnly: !partial, endAdornment: <InputAdornment position="end">{currencySymbol(currency, language)}</InputAdornment> },
                htmlInput: { inputMode: 'decimal', autoComplete: 'off', 'data-testid': 'staff-refund-amount' },
              }}
            />
            <Variants
              compact={compact}
              partial={partial}
              full={(
                <Stack useFlexGap spacing="0.75rem">
                  {preview.hasShipment ? (
                    <Alert severity="warning">
                      <AlertTitle>{messages.shippedWarningTitle}</AlertTitle>
                      {messages.shippedWarningBody}
                    </Alert>
                  ) : null}
                  {restockVisible || options.removeFromPackingListOffered || preview.onPackingList ? (
                    <RefundFieldset>
                      <Typography component="legend" variant="overline" color="textSecondary" sx={{ px: '0.25rem' }}>
                        {preview.onPackingList ? messages.goodsAndPackingTitle : messages.goodsTitle}
                      </Typography>
                      <Stack useFlexGap spacing="0.5rem">
                        {restockVisible ? (
                          <FormControlLabel
                            sx={{ alignItems: 'flex-start', m: 0 }}
                            control={<Checkbox checked={restock} disabled={partial || pending} onChange={(_, checked) => setRestock(checked)} sx={{ mt: '-0.4rem' }} data-testid="staff-refund-restock" />}
                            label={(
                              <Box>
                                <Typography>{messages.restock}</Typography>
                                <Typography variant="body2" color="textSecondary">{preview.hasShipment ? messages.restockHintShipped : messages.restockHintUnshipped}</Typography>
                                <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: '0.35rem', mt: '0.35rem' }}>
                                  {returnableUnits.map((unit) => <Chip key={unit} size="small" variant="outlined" icon={<PackageIcon />} label={unit} />)}
                                </Stack>
                              </Box>
                            )}
                          />
                        ) : null}
                        {options.removeFromPackingListOffered || preview.onPackingList ? (
                          <FormControlLabel
                            sx={{ alignItems: 'flex-start', m: 0 }}
                            disabled={partial || pending || !options.removeFromPackingListOffered || restocking}
                            control={<Checkbox checked={options.removeFromPackingListOffered && removingFromPackingList} onChange={(_, checked) => setRemoveFromPackingList(checked)} sx={{ mt: '-0.4rem' }} data-testid="staff-refund-remove-from-packing-list" />}
                            label={(
                              <Box>
                                <Typography>{messages.removeFromPackingList}</Typography>
                                <Typography variant="body2" color="textSecondary">
                                  {!options.removeFromPackingListOffered
                                    ? messages.removeFromPackingListUnavailable
                                    : restocking ? messages.removeFromPackingListWithRestock : messages.removeFromPackingListHint}
                                </Typography>
                              </Box>
                            )}
                          />
                        ) : null}
                      </Stack>
                    </RefundFieldset>
                  ) : null}
                </Stack>
              )}
              part={(
                <Alert severity="info" data-testid="staff-refund-partial-info">
                  <AlertTitle>{endsAccess ? messages.partialFullInfoTitle : messages.partialInfoTitle}</AlertTitle>
                  {endsAccess ? messages.partialFullInfoBody : mayEndLater === null ? messages.partialInfoBody : `${messages.partialInfoBody} ${mayEndLater}`}
                </Alert>
              )}
            />
            <TextField
              label={messages.reasonLabel}
              placeholder={messages.reasonPlaceholder}
              value={reason}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
              multiline
              minRows={3}
              helperText={messages.reasonCount({ count: reason.length, max: REASON_MAX_LENGTH })}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { maxLength: REASON_MAX_LENGTH, 'data-testid': 'staff-refund-reason' } }}
            />
          </Stack>
          <RefundConsequencesPanel>
            <Typography component="h3" variant="overline" color="textSecondary">{messages.consequencesTitle}</Typography>
            <RefundPlainList data-testid="staff-refund-consequences">
              <Consequence icon={<RefundIcon />} hint={messages.consequenceProviderHint}>{providerConsequence}</Consequence>
              {testMode
                ? <Consequence icon={<TestModeIcon />} hint={messages.consequenceTestModeHint}>{messages.consequenceTestMode}</Consequence>
                : <Consequence icon={<MailIcon />}>{messages.consequenceEmail({ buyer })}</Consequence>}
              {preview.hasInvoice ? <Consequence icon={<InvoiceIcon />}>{messages.consequenceInvoice}</Consequence> : null}
              {preview.remainderSource === 'platform' ? <Consequence icon={<StatusIcon />}>{messages.consequencePlatformRecords}</Consequence> : null}
              <Box component="li">
                <Variants
                  compact={compact}
                  partial={partial}
                  full={<RefundConsequenceGroup>{fullConsequences}</RefundConsequenceGroup>}
                  part={<RefundConsequenceGroup>{partialConsequences}</RefundConsequenceGroup>}
                />
              </Box>
              <Consequence icon={<LockIcon />} hint={messages.consequenceFinalHint} strong>{messages.consequenceFinal}</Consequence>
            </RefundPlainList>
          </RefundConsequencesPanel>
        </Box>
      </DialogContent>
      {submitError === null ? null : (
        <Alert severity="error" sx={{ flexShrink: 0, mx: { xs: '1rem', sm: '1.5rem' }, my: '0.75rem' }} data-testid="staff-refund-error">{submitError}</Alert>
      )}
      <RefundDialogActions disableSpacing>
        {phone ? [submitButton, cancelButton, finalNote] : [finalNote, cancelButton, submitButton]}
      </RefundDialogActions>
    </RefundSheetDialog>
  );
};
