import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  accentColorSchema,
  SOCIAL_LINK_LABEL_MAX_LENGTH,
  SOCIAL_LINKS_MAX_COUNT,
  TENANT_NAME_MAX_LENGTH,
  TENANT_OG_DESCRIPTION_MAX_LENGTH,
  TENANT_OG_TITLE_MAX_LENGTH,
  tenantSocialLinkSchema,
} from '#core/domain/index.js';
import type { ExemptionBasisKind, TenantSecretKey, TenantSocialLink } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { AuthenticationMethods } from '../../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../../components/ui/ChangePasswordForm.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import {
  BUILD_SHA,
  BUILD_VERSION,
  isBuildMismatch,
  shortSha,
} from '../../../lib/build-info.js';
import { BrandSwatch, Eyebrow } from '../../../theme.js';
import { deriveBrandPalette } from '../../../theme-branding.js';
import { SecretField } from '../integrations/SecretField.js';
import { usePanelContext } from '../panel-context.js';

const isExemptionBasisKind = (value: unknown): value is ExemptionBasisKind =>
  value === 'art_113_1' ||
  value === 'art_113_9' ||
  value === 'art_43_1' ||
  value === 'other_statute' ||
  value === 'other';

const BillingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [url, setUrl] = useState<string | null>(null);

  const value = url ?? settings.data?.settings.billingPortalUrl ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({ billingPortalUrl: value.trim() === '' ? null : value.trim() });
  };

  return (
    <SectionCard title={t.billing.heading} description={t.billing.intro} onSubmit={submit}>
        <FormControl fullWidth>
          <FormLabel htmlFor="billing-portal-url">{t.billing.urlLabel}</FormLabel>
          {settings.isPending ? (
            <StatusView
              state={{ kind: 'loading', label: t.common.loading }}
              data-testid="billing-portal-url-loading"
            />
          ) : (
            <OutlinedInput
              id="billing-portal-url"
              type="url"
              value={value}
              disabled={!canEdit || !settings.isSuccess}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t.billing.placeholder}
              inputProps={{ 'data-testid': 'billing-portal-url' }}
            />
          )}
        </FormControl>
        {settings.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(settings.error, t) }} />
        ) : null}
        {canEdit ? (
          <Box>
            <Button
              type="submit"
              variant="outlined"
              data-testid="billing-portal-save"
              disabled={updateSettings.isPending || !settings.isSuccess}
            >
              {updateSettings.isPending ? t.billing.saving : t.billing.save}
            </Button>
          </Box>
        ) : null}
        {updateSettings.isSuccess ? (
          <Typography variant="caption" component="p" data-testid="billing-portal-saved">
            {t.billing.saved}
          </Typography>
        ) : null}
        {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const SupportSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [email, setEmail] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const emailValue = email ?? settings.data?.settings.supportEmail ?? '';
  const urlValue = url ?? settings.data?.settings.supportUrl ?? '';
  return (
    <SectionCard
      title={t.support.heading}
      description={t.support.intro}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({
          supportEmail: emailValue.trim() === '' ? null : emailValue.trim(),
          supportUrl: urlValue.trim() === '' ? null : urlValue.trim(),
        });
      }}
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="support-email">{t.support.emailLabel}</FormLabel>
        <OutlinedInput
          id="support-email"
          type="email"
          value={emailValue}
          disabled={!canEdit}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="support-url">{t.support.urlLabel}</FormLabel>
        <OutlinedInput
          id="support-url"
          type="url"
          value={urlValue}
          disabled={!canEdit}
          onChange={(event) => setUrl(event.target.value)}
        />
      </FormControl>
      {canEdit ? (
        <Button type="submit" variant="outlined" disabled={update.isPending}>
          {t.support.save}
        </Button>
      ) : null}
      {update.isError ? <Alert>{localizeError(update.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const previewFor = (
  secrets: { key: TenantSecretKey; maskedPreview: string }[] | undefined,
  key: TenantSecretKey,
): string | null => secrets?.find((secret) => secret.key === key)?.maskedPreview ?? null;

const KsefSettings = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const testConnection = useMutation(actions.testKsefConnection);
  const tokenPreview = previewFor(secrets.data?.secrets, 'ksef.token');
  const nipPreview = previewFor(secrets.data?.secrets, 'ksef.contextNip');
  const ready = tokenPreview !== null && nipPreview !== null;

  return (
    <Stack useFlexGap spacing="1rem">
      <Typography variant="h6" component="h3">{t.integrations.ksefHeading}</Typography>
      <Typography color="text.secondary">{t.integrations.ksefDescription}</Typography>
      <Typography variant="body2">{t.integrations.ksefTokenHelp}</Typography>
      {secrets.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
      ) : secrets.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t) }} />
      ) : canEdit ? (
        <>
          <SecretField
            secretKey="ksef.contextNip"
            label={t.integrations.ksefContextNipLabel}
            maskedPreview={nipPreview}
          />
          <SecretField
            secretKey="ksef.token"
            label={t.integrations.ksefTokenLabel}
            maskedPreview={tokenPreview}
          />
        </>
      ) : (
        <Typography variant="body2">
          {ready ? t.integrations.configured : t.integrations.notConfigured}
        </Typography>
      )}
      <Button
        type="button"
        variant="contained"
        data-testid="ksef-test-connection"
        disabled={!canEdit || !ready || testConnection.isPending}
        onClick={() => testConnection.mutate(undefined)}
        sx={{ alignSelf: 'flex-start' }}
      >
        {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
      </Button>
      {!ready ? (
        <Typography variant="caption" component="p">{t.integrations.ksefSaveFirst}</Typography>
      ) : null}
      {testConnection.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="ksef-test-result">
          {testConnection.data.diagnostic}
        </Typography>
      ) : null}
      {testConnection.isError ? (
        <Alert data-testid="ksef-test-error">{localizeError(testConnection.error, t)}</Alert>
      ) : null}
    </Stack>
  );
};

const InvoiceSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
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
  const provider = settings.data?.settings.invoicingProvider ?? 'ifirma';
  const [sellerName, setSellerName] = useState<string | null>(null);
  const [sellerAddress, setSellerAddress] = useState<string | null>(null);

  return (
    <SectionCard title={t.billing.invoiceHeading} description={t.billing.invoiceIntro}>
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
          value={provider}
          disabled={!canEdit || settings.isPending || updateSettings.isPending}
          onChange={(event) =>
            updateSettings.mutate({
              invoicingProvider: event.target.value === 'ksef' ? 'ksef' : 'ifirma',
            })}
        >
          <MenuItem value="ifirma">{t.billing.providerIfirma}</MenuItem>
          <MenuItem value="ksef">{t.billing.providerKsef}</MenuItem>
        </Select>
      </FormControl>
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
      {provider === 'ksef' ? <KsefSettings canEdit={canEdit} /> : null}
      {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const LegalSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [termsUrl, setTermsUrl] = useState<string | null>(null);
  const [privacyUrl, setPrivacyUrl] = useState<string | null>(null);

  const termsValue = termsUrl ?? settings.data?.settings.termsUrl ?? '';
  const privacyValue = privacyUrl ?? settings.data?.settings.privacyUrl ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({
      termsUrl: termsValue.trim() === '' ? null : termsValue.trim(),
      privacyUrl: privacyValue.trim() === '' ? null : privacyValue.trim(),
    });
  };

  const disabled = !canEdit || !settings.isSuccess;

  return (
    <SectionCard title={t.legal.heading} description={t.legal.intro} onSubmit={submit}>
      {settings.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.common.loading }} data-testid="legal-loading" />
      ) : (
        <>
          <FormControl fullWidth>
            <FormLabel htmlFor="legal-terms-url">{t.legal.termsLabel}</FormLabel>
            <OutlinedInput
              id="legal-terms-url"
              type="url"
              value={termsValue}
              disabled={disabled}
              onChange={(event) => setTermsUrl(event.target.value)}
              placeholder={t.legal.termsPlaceholder}
              inputProps={{ 'data-testid': 'legal-terms-url' }}
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="legal-privacy-url">{t.legal.privacyLabel}</FormLabel>
            <OutlinedInput
              id="legal-privacy-url"
              type="url"
              value={privacyValue}
              disabled={disabled}
              onChange={(event) => setPrivacyUrl(event.target.value)}
              placeholder={t.legal.privacyPlaceholder}
              inputProps={{ 'data-testid': 'legal-privacy-url' }}
            />
          </FormControl>
        </>
      )}
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(settings.error, t) }} />
      ) : null}
      {canEdit ? (
        <Box>
          <Button
            type="submit"
            variant="outlined"
            data-testid="legal-save"
            disabled={updateSettings.isPending || !settings.isSuccess}
          >
            {updateSettings.isPending ? t.legal.saving : t.legal.save}
          </Button>
        </Box>
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="legal-saved">
          {t.legal.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const BrandingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [name, setName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [ogTitle, setOgTitle] = useState<string | null>(null);
  const [ogDescription, setOgDescription] = useState<string | null>(null);
  const [ogImageUrl, setOgImageUrl] = useState<string | null>(null);
  const [socialLinks, setSocialLinks] = useState<TenantSocialLink[] | null>(null);
  const [accentError, setAccentError] = useState(false);
  const [socialLinkUrlErrors, setSocialLinkUrlErrors] = useState<number[]>([]);

  const nameValue = name ?? settings.data?.settings.name ?? '';
  const logoValue = logoUrl ?? settings.data?.settings.logoUrl ?? '';
  const accentValue = accentColor ?? settings.data?.settings.accentColor ?? '';
  const faviconValue = faviconUrl ?? settings.data?.settings.faviconUrl ?? '';
  const ogTitleValue = ogTitle ?? settings.data?.settings.ogTitle ?? '';
  const ogDescriptionValue = ogDescription ?? settings.data?.settings.ogDescription ?? '';
  const ogImageValue = ogImageUrl ?? settings.data?.settings.ogImageUrl ?? '';
  const socialLinksValue = socialLinks ?? settings.data?.settings.socialLinks ?? [];
  const accentValid = accentColorSchema.safeParse(accentValue.trim()).success;
  const swatch = accentValid ? deriveBrandPalette(accentValue.trim()) : null;

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(actions.meInvalidates()),
        queryClient.invalidateQueries(actions.tenantSettingsInvalidates()),
        queryClient.invalidateQueries(actions.publicOfferInvalidates()),
      ]);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const accent = accentValue.trim();
    if (accent !== '' && !accentValid) {
      setAccentError(true);
      return;
    }
    const normalizedSocialLinks = socialLinksValue.map((item) => ({
      label: item.label.trim(),
      url: item.url.trim(),
    }));
    const invalidSocialLinkUrls = normalizedSocialLinks.flatMap((item, index) =>
      tenantSocialLinkSchema.shape.url.safeParse(item.url).success ? [] : [index]);
    if (invalidSocialLinkUrls.length > 0) {
      setSocialLinkUrlErrors(invalidSocialLinkUrls);
      return;
    }
    setAccentError(false);
    setSocialLinkUrlErrors([]);
    updateSettings.mutate({
      name: nameValue.trim(),
      socialLinks: normalizedSocialLinks,
      logoUrl: logoValue.trim() === '' ? null : logoValue.trim(),
      accentColor: accent === '' ? null : accent,
      faviconUrl: faviconValue.trim() === '' ? null : faviconValue.trim(),
      ogTitle: ogTitleValue.trim() === '' ? null : ogTitleValue.trim(),
      ogDescription: ogDescriptionValue.trim() === '' ? null : ogDescriptionValue.trim(),
      ogImageUrl: ogImageValue.trim() === '' ? null : ogImageValue.trim(),
    });
  };

  const disabled = !canEdit || !settings.isSuccess;

  return (
    <SectionCard title={t.branding.heading} description={t.branding.intro} onSubmit={submit}>
      {settings.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.common.loading }} data-testid="branding-loading" />
      ) : (
        <>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-name">{t.branding.nameLabel}</FormLabel>
            <OutlinedInput
              id="branding-name"
              value={nameValue}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              inputProps={{ maxLength: TENANT_NAME_MAX_LENGTH, 'data-testid': 'branding-name' }}
            />
            <Typography variant="caption" component="p">{t.branding.nameHint}</Typography>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-logo-url">{t.branding.logoLabel}</FormLabel>
            <OutlinedInput
              id="branding-logo-url"
              value={logoValue}
              disabled={disabled}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder={t.branding.logoPlaceholder}
              inputProps={{ 'data-testid': 'branding-logo-url' }}
            />
          </FormControl>
          <FormControl fullWidth error={accentError}>
            <FormLabel htmlFor="branding-accent-color">{t.branding.accentLabel}</FormLabel>
            <Stack direction="row" useFlexGap sx={{ alignItems: 'center', columnGap: '0.75rem' }}>
              <OutlinedInput
                id="branding-accent-color"
                value={accentValue}
                disabled={disabled}
                onChange={(event) => {
                  setAccentColor(event.target.value);
                  setAccentError(false);
                }}
                placeholder={t.branding.accentPlaceholder}
                inputProps={{ 'data-testid': 'branding-accent-color' }}
                sx={{ maxWidth: '11rem' }}
              />
              <BrandSwatch
                aria-hidden
                data-testid="branding-accent-swatch"
                swatchColor={swatch === null ? null : swatch.main}
              />
            </Stack>
            <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
              {accentError ? t.branding.accentInvalid : t.branding.previewHint}
            </Typography>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-favicon-url">{t.branding.faviconLabel}</FormLabel>
            <OutlinedInput
              id="branding-favicon-url"
              value={faviconValue}
              disabled={disabled}
              onChange={(event) => setFaviconUrl(event.target.value)}
              placeholder={t.branding.faviconPlaceholder}
              inputProps={{ 'data-testid': 'branding-favicon-url' }}
            />
          </FormControl>
          <Typography variant="h6" component="h3">{t.branding.profileLinksHeading}</Typography>
          <Typography variant="body2">
            {t.branding.profileLinksIntro({ count: SOCIAL_LINKS_MAX_COUNT })}
          </Typography>
          {socialLinksValue.map((item, index) => (
            <Stack
              key={index}
              direction={{ xs: 'column', sm: 'row' }}
              useFlexGap
              sx={{ gap: '0.75rem', alignItems: { sm: 'end' } }}
            >
              <FormControl fullWidth>
                <FormLabel htmlFor={`branding-social-label-${String(index)}`}>
                  {t.branding.socialLinkLabel}
                </FormLabel>
                <OutlinedInput
                  id={`branding-social-label-${String(index)}`}
                  value={item.label}
                  required
                  disabled={disabled}
                  placeholder={t.branding.socialLinkLabelPlaceholder}
                  onChange={(event) => setSocialLinks(socialLinksValue.map((link, linkIndex) =>
                    linkIndex === index ? { ...link, label: event.target.value } : link))}
                  inputProps={{
                    maxLength: SOCIAL_LINK_LABEL_MAX_LENGTH,
                    'data-testid': `branding-social-label-${String(index)}`,
                  }}
                />
              </FormControl>
              <FormControl fullWidth error={socialLinkUrlErrors.includes(index)}>
                <FormLabel htmlFor={`branding-social-url-${String(index)}`}>
                  {t.branding.socialLinkUrl}
                </FormLabel>
                <OutlinedInput
                  id={`branding-social-url-${String(index)}`}
                  type="url"
                  value={item.url}
                  required
                  disabled={disabled}
                  placeholder={t.branding.socialLinkUrlPlaceholder}
                  onChange={(event) => {
                    setSocialLinks(socialLinksValue.map((link, linkIndex) =>
                      linkIndex === index ? { ...link, url: event.target.value } : link));
                    setSocialLinkUrlErrors(socialLinkUrlErrors.filter((errorIndex) => errorIndex !== index));
                  }}
                  inputProps={{ 'data-testid': `branding-social-url-${String(index)}` }}
                />
                {socialLinkUrlErrors.includes(index) ? (
                  <Typography variant="caption" component="p">
                    {t.branding.socialLinkUrlInvalid}
                  </Typography>
                ) : null}
              </FormControl>
              <Button
                type="button"
                color="error"
                disabled={disabled}
                onClick={() => setSocialLinks(socialLinksValue.filter((_, linkIndex) => linkIndex !== index))}
              >
                {t.branding.removeSocialLink}
              </Button>
            </Stack>
          ))}
          <Box>
            <Button
              type="button"
              variant="text"
              disabled={disabled || socialLinksValue.length >= SOCIAL_LINKS_MAX_COUNT}
              onClick={() => setSocialLinks([...socialLinksValue, { label: '', url: '' }])}
              data-testid="branding-social-add"
            >
              {t.branding.addSocialLink}
            </Button>
          </Box>
          <Typography variant="h6" component="h3">{t.branding.socialHeading}</Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-og-title">{t.branding.ogTitleLabel}</FormLabel>
            <OutlinedInput
              id="branding-og-title"
              value={ogTitleValue}
              disabled={disabled}
              onChange={(event) => setOgTitle(event.target.value)}
              inputProps={{
                maxLength: TENANT_OG_TITLE_MAX_LENGTH,
                'data-testid': 'branding-og-title',
              }}
            />
            <Typography variant="caption" component="p">{t.branding.ogTitleHint}</Typography>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-og-description">{t.branding.ogDescriptionLabel}</FormLabel>
            <OutlinedInput
              id="branding-og-description"
              value={ogDescriptionValue}
              disabled={disabled}
              multiline
              minRows={3}
              onChange={(event) => setOgDescription(event.target.value)}
              inputProps={{
                maxLength: TENANT_OG_DESCRIPTION_MAX_LENGTH,
                'data-testid': 'branding-og-description',
              }}
            />
            <Typography variant="caption" component="p">
              {t.branding.ogDescriptionHint}
            </Typography>
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="branding-og-image-url">{t.branding.ogImageLabel}</FormLabel>
            <OutlinedInput
              id="branding-og-image-url"
              type="url"
              value={ogImageValue}
              disabled={disabled}
              onChange={(event) => setOgImageUrl(event.target.value)}
              inputProps={{ 'data-testid': 'branding-og-image-url' }}
            />
            <Typography variant="caption" component="p">{t.branding.ogImageHint}</Typography>
          </FormControl>
        </>
      )}
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(settings.error, t) }} />
      ) : null}
      {canEdit ? (
        <Box>
          <Button
            type="submit"
            variant="outlined"
            data-testid="branding-save"
            disabled={updateSettings.isPending || !settings.isSuccess}
          >
            {updateSettings.isPending ? t.branding.saving : t.branding.save}
          </Button>
        </Box>
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="branding-saved">
          {t.branding.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const SecurityPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { email } = usePanelContext();
  const queryClient = useQueryClient();
  const passkeys = useQuery(actions.passkeys);
  const registerPasskey = useMutation({
    ...actions.registerPasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });
  const removePasskey = useMutation({
    ...actions.removePasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });
  const enableTwoFactor = useMutation(actions.enableTwoFactor);
  const verifyTotp = useMutation(actions.verifyTotp);
  const disableTwoFactor = useMutation(actions.disableTwoFactor);
  const regenerateBackupCodes = useMutation(actions.regenerateBackupCodes);
  const changePassword = useMutation(actions.changePassword);
  const requestPasswordReset = useMutation(actions.requestPasswordReset);
  const requestPasskeyPasswordSetup = useMutation(actions.requestPasswordReset);
  const passwordSetupInput = {
    email,
    redirectTo: new URL('/reset-password', window.location.origin).toString(),
    language,
  };

  return (
    <SectionCard title={t.security.heading} data-testid="security-settings">
      <Stack useFlexGap spacing="1.75rem">
        <Box sx={{ display: 'grid', gap: '0.8rem' }}>
          <ChangePasswordForm
            pending={changePassword.isPending}
            success={changePassword.isSuccess}
            error={changePassword.error}
            onSubmit={(input) => changePassword.mutate(input)}
          />
          <Box sx={{ display: 'grid', gap: '0.8rem' }}>
            <Eyebrow variant="overline" component="h3">
              {t.security.setOrResetPasswordHeading}
            </Eyebrow>
            <Button
              variant="outlined"
              data-testid="security-reset-password"
              disabled={requestPasswordReset.isPending}
              onClick={() => requestPasswordReset.mutate(passwordSetupInput)}
            >
              {requestPasswordReset.isPending
                ? t.security.resetSending
                : t.security.setOrResetPassword}
            </Button>
            {requestPasswordReset.isSuccess ? (
              <Typography variant="caption" component="p" data-testid="security-reset-sent">
                {t.security.resetSent}
              </Typography>
            ) : null}
            {requestPasswordReset.isError ? (
              <Alert>{localizeError(requestPasswordReset.error, t)}</Alert>
            ) : null}
          </Box>
        </Box>

        <AuthenticationMethods
          passkeys={{ data: passkeys.data, pending: passkeys.isPending, error: passkeys.error }}
          registerPasskey={{
            pending: registerPasskey.isPending,
            success: registerPasskey.isSuccess,
            error: registerPasskey.error,
            run: registerPasskey.mutate,
          }}
          removePasskey={{
            pending: removePasskey.isPending,
            success: removePasskey.isSuccess,
            error: removePasskey.error,
            run: removePasskey.mutate,
          }}
          requestPasswordSetup={{
            pending: requestPasskeyPasswordSetup.isPending,
            success: requestPasskeyPasswordSetup.isSuccess,
            error: requestPasskeyPasswordSetup.error,
            run: () => requestPasskeyPasswordSetup.mutate(passwordSetupInput),
          }}
          enableTwoFactor={{
            data: enableTwoFactor.data,
            submittedAt: enableTwoFactor.submittedAt,
            pending: enableTwoFactor.isPending,
            success: enableTwoFactor.isSuccess,
            error: enableTwoFactor.error,
            run: enableTwoFactor.mutate,
          }}
          verifyTotp={{
            pending: verifyTotp.isPending,
            success: verifyTotp.isSuccess,
            error: verifyTotp.error,
            run: verifyTotp.mutate,
          }}
          disableTwoFactor={{
            submittedAt: disableTwoFactor.submittedAt,
            pending: disableTwoFactor.isPending,
            success: disableTwoFactor.isSuccess,
            error: disableTwoFactor.error,
            run: disableTwoFactor.mutate,
          }}
          regenerateBackupCodes={{
            data: regenerateBackupCodes.data,
            submittedAt: regenerateBackupCodes.submittedAt,
            pending: regenerateBackupCodes.isPending,
            success: regenerateBackupCodes.isSuccess,
            error: regenerateBackupCodes.error,
            run: regenerateBackupCodes.mutate,
          }}
        />
      </Stack>
    </SectionCard>
  );
};

const BuildInfoPanel = () => {
  const t = useTranslations();
  const health = useQuery(actions.health);
  const mismatch = health.data !== undefined && isBuildMismatch(health.data);

  return (
    <SectionCard title={t.buildInfo.heading} description={t.buildInfo.intro}>
      <Stack useFlexGap spacing="0.3rem">
        <Typography variant="body2">{t.buildInfo.browserVersion}: {BUILD_VERSION}</Typography>
        <Typography variant="body2">{t.buildInfo.browserSha}: {BUILD_SHA}</Typography>
        {health.data === undefined ? null : (
          <>
            <Typography variant="body2">{t.buildInfo.serverVersion}: {health.data.version}</Typography>
            <Typography variant="body2">{t.buildInfo.serverSha}: {shortSha(health.data.sha)}</Typography>
          </>
        )}
      </Stack>
      {mismatch ? (
        <Alert severity="warning" data-testid="build-mismatch-warning">
          {t.buildInfo.mismatch}
        </Alert>
      ) : null}
    </SectionCard>
  );
};

export const SettingsPanel = () => {
  const { tenant } = usePanelContext();
  const t = useTranslations();
  return (
    <PanelPage title={t.sections.settings}>
      <BillingSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <SupportSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <InvoiceSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <LegalSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <BrandingSettingsPanel canEdit={tenant.staffRole === 'owner'} />
      <SecurityPanel />
      <BuildInfoPanel />
    </PanelPage>
  );
};
