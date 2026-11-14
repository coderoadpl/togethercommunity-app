import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link as MuiLink,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  ExemptionBasisKind,
} from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

const isExemptionBasisKind = (value: unknown): value is ExemptionBasisKind =>
  value === 'art_113_1' ||
  value === 'art_113_9' ||
  value === 'art_43_1' ||
  value === 'other_statute' ||
  value === 'other';

const KsefCredentialsPointer = () => {
  const t = useTranslations();
  return (
    <Stack useFlexGap spacing="0.5rem">
      <Typography variant="h3" component="h3">{t.integrations.ksefHeading}</Typography>
      <Typography variant="body2">{t.billing.ksefConfiguredInIntegrations}</Typography>
      <Box>
        <MuiLink
          component={Link}
          to="/panel/integrations"
          hash="invoicing"
          data-testid="ksef-integrations-link"
        >
          {t.billing.ksefOpenIntegrations}
        </MuiLink>
      </Box>
    </Stack>
  );
};

export const InvoiceSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const enabled = settings.data?.settings.autoIssueInvoices ?? false;
  const scope = settings.data?.settings.autoIssueInvoiceScope ?? 'b2b_only';
  const storedMode = settings.data?.settings.invoiceVatMode ??
    (settings.data?.settings.invoiceVatRatePercent == null ? '' : 'rate');
  const storedRate = settings.data?.settings.invoiceVatRatePercent ?? '';
  const [vatChoice, setVatChoice] = useState<string | number | null>(null);
  const [basisKind, setBasisKind] = useState<ExemptionBasisKind | '' | null>(null);
  const [basis, setBasis] = useState<string | null>(null);
  const treatment = vatChoice ?? (storedMode === 'exempt' ? 'exempt' : storedRate);
  const selectedBasisKind = basisKind ?? settings.data?.settings.invoiceExemptionBasisKind ?? '';
  const basisValue = basis ?? settings.data?.settings.invoiceExemptionBasis ?? '';
  const basisInvalid = treatment === 'exempt' && (
    selectedBasisKind === '' ||
    basisValue.trim() === '' ||
    (selectedBasisKind === 'art_43_1' && !/\bpkt\s*\d/iu.test(basisValue))
  );
  const provider = settings.data?.settings.invoicingProvider ?? '';
  const [sellerName, setSellerName] = useState<string | null>(null);
  const [sellerAddress, setSellerAddress] = useState<string | null>(null);
  useToastOutcome(
    updateSettings.isSuccess,
    t.common.saved,
    updateSettings.error === null ? null : localizePanelError(updateSettings.error, t),
  );

  return (
    <SectionCard
      title={t.billing.invoiceHeading}
      description={t.billing.invoiceIntro}
      actions={(
        <Button
          variant="contained"
          disabled={!canEdit || settings.isPending || updateSettings.isPending || basisInvalid}
          onClick={() => updateSettings.mutate({
            invoiceVatMode: treatment === 'exempt' ? 'exempt' : 'rate',
            invoiceVatRatePercent:
              treatment === 5 || treatment === 8 || treatment === 23 ? treatment : null,
            invoiceExemptionBasisKind: treatment === 'exempt' && selectedBasisKind !== ''
              ? selectedBasisKind
              : null,
            invoiceExemptionBasis: treatment === 'exempt' ? basisValue.trim() || null : null,
            invoiceSellerName: sellerName ?? settings.data?.settings.invoiceSellerName ?? null,
            invoiceSellerAddress: sellerAddress ?? settings.data?.settings.invoiceSellerAddress ?? null,
          })}
        >
          {t.billing.saveSeller}
        </Button>
      )}
    >
      <FormControlLabel
        control={(
          <Checkbox
            checked={enabled}
            disabled={!canEdit || settings.isPending || updateSettings.isPending}
            onChange={(event) => updateSettings.mutate({ autoIssueInvoices: event.target.checked })}
          />
        )}
        label={t.billing.autoIssue}
      />
      <FormControl fullWidth>
        <FormLabel id="invoice-provider-label">{t.billing.invoicingProvider}</FormLabel>
        <Select
          labelId="invoice-provider-label"
          displayEmpty
          value={provider}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) =>
            updateSettings.mutate({
              invoicingProvider: event.target.value === 'ksef' ? 'ksef' : 'ifirma',
            })}
        >
          <MenuItem value="" disabled>{t.billing.providerUnset}</MenuItem>
          <MenuItem value="ifirma">{t.billing.providerIfirma}</MenuItem>
          <MenuItem value="ksef">{t.billing.providerKsef}</MenuItem>
        </Select>
      </FormControl>
      {provider === 'ksef' ? (
        <FormControl fullWidth>
          <FormLabel id="ksef-submission-mode-label">{t.billing.ksefSubmissionMode}</FormLabel>
          <Select
            labelId="ksef-submission-mode-label"
            value={settings.data?.settings.ksefSubmissionMode ?? 'automatic'}
            disabled={!canEdit || settings.isPending || updateSettings.isPending}
            onChange={(event) => updateSettings.mutate({
              ksefSubmissionMode: event.target.value === 'manual' ? 'manual' : 'automatic',
            })}
          >
            <MenuItem value="automatic">{t.billing.ksefSubmissionAutomatic}</MenuItem>
            <MenuItem value="manual">{t.billing.ksefSubmissionManual}</MenuItem>
          </Select>
        </FormControl>
      ) : null}
      <FormControl fullWidth>
        <FormLabel id="invoice-auto-scope-label">{t.billing.autoIssueScope}</FormLabel>
        <Select
          labelId="invoice-auto-scope-label"
          value={scope}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) =>
            updateSettings.mutate({
              autoIssueInvoiceScope: event.target.value === 'all' ? 'all' : 'b2b_only',
            })}
        >
          <MenuItem value="b2b_only">{t.billing.b2bOnly}</MenuItem>
          <MenuItem value="all">{t.billing.allBuyers}</MenuItem>
        </Select>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel id="invoice-vat-rate-label">{t.billing.vatTreatment}</FormLabel>
        <Select
          data-testid="invoice-vat-treatment"
          labelId="invoice-vat-rate-label"
          value={treatment}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) => {
            const raw = event.target.value;
            setVatChoice(raw === 'exempt' ? 'exempt' : Number(raw) || '');
            if (raw !== 'exempt') {
              setBasisKind('');
              setBasis('');
            }
          }}
        >
          <MenuItem value="">{t.billing.vatRateUnset}</MenuItem>
          <MenuItem value={5}>{t.billing.vatTreatmentRate} 5%</MenuItem>
          <MenuItem value={8}>{t.billing.vatTreatmentRate} 8%</MenuItem>
          <MenuItem value={23}>{t.billing.vatTreatmentRate} 23%</MenuItem>
          <MenuItem value="exempt">{t.billing.vatTreatmentExempt}</MenuItem>
        </Select>
        <Typography variant="caption" component="p">{t.billing.vatTreatmentHelp}</Typography>
        <Typography variant="caption" component="p">{t.billing.vatRateHint}</Typography>
      </FormControl>
      {treatment === 'exempt' ? (
        <>
          <FormControl fullWidth error={basisInvalid}>
            <FormLabel id="invoice-exemption-kind-label">{t.billing.exemptionBasisKind}</FormLabel>
            <Select
              data-testid="invoice-exemption-kind"
              labelId="invoice-exemption-kind-label"
              value={selectedBasisKind}
              onChange={(event) => {
                const kind = event.target.value;
                if (!isExemptionBasisKind(kind)) return;
                setBasisKind(kind);
                if (kind === 'art_113_1') {
                  setBasis('art. 113 ust. 1 ustawy o podatku od towarów i usług');
                } else if (kind === 'art_113_9') {
                  setBasis('art. 113 ust. 9 ustawy o podatku od towarów i usług');
                } else if (kind === 'art_43_1') {
                  setBasis('art. 43 ust. 1 pkt ');
                } else {
                  setBasis('');
                }
              }}
            >
              <MenuItem value="art_113_1">{t.billing.exemptionBasisKindArt113_1}</MenuItem>
              <MenuItem value="art_113_9">{t.billing.exemptionBasisKindArt113_9}</MenuItem>
              <MenuItem value="art_43_1">{t.billing.exemptionBasisKindArt43_1}</MenuItem>
              <MenuItem value="other_statute">{t.billing.exemptionBasisKindOtherStatute}</MenuItem>
              <MenuItem value="other">{t.billing.exemptionBasisKindOther}</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth error={basisInvalid}>
            <FormLabel htmlFor="invoice-exemption-basis">{t.billing.exemptionBasis}</FormLabel>
            <OutlinedInput
              id="invoice-exemption-basis"
              inputProps={{ 'data-testid': 'invoice-exemption-basis', maxLength: 256 }}
              value={basisValue}
              readOnly={selectedBasisKind === 'art_113_1' || selectedBasisKind === 'art_113_9'}
              onChange={(event) => setBasis(event.target.value)}
            />
            <Typography variant="caption" color={basisInvalid ? 'error' : 'text.secondary'}>
              {basisInvalid
                ? t.billing.exemptionBasisRequired
                : selectedBasisKind === 'art_43_1'
                  ? t.billing.exemptionBasisArt43Help
                  : t.billing.exemptionBasisHelp}
            </Typography>
          </FormControl>
          <Typography variant="caption">{t.billing.exemptNote}</Typography>
        </>
      ) : null}
      <FormControl fullWidth>
        <FormLabel htmlFor="invoice-seller-name">{t.billing.sellerName}</FormLabel>
        <OutlinedInput
          id="invoice-seller-name"
          value={sellerName ?? settings.data?.settings.invoiceSellerName ?? ''}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) => setSellerName(event.target.value)}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="invoice-seller-address">{t.billing.sellerAddress}</FormLabel>
        <OutlinedInput
          id="invoice-seller-address"
          value={sellerAddress ?? settings.data?.settings.invoiceSellerAddress ?? ''}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) => setSellerAddress(event.target.value)}
        />
      </FormControl>
      {provider === 'ksef' ? <KsefCredentialsPointer /> : null}
    </SectionCard>
  );
};
