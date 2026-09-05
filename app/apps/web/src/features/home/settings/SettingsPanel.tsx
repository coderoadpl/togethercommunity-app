import { useState, type FormEvent, type SyntheticEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useRouterState } from '@tanstack/react-router';

import {
  accentColorSchema,
  DEFAULT_LANGUAGE,
  languageOrDefault,
  LANGUAGES,
  MAX_CUSTOM_DOMAINS_PER_TENANT,
  SHARE_IMAGE_RECOMMENDED_HEIGHT,
  SHARE_IMAGE_RECOMMENDED_WIDTH,
  SOCIAL_LINK_LABEL_MAX_LENGTH,
  SOCIAL_LINKS_MAX_COUNT,
  TENANT_NAME_MAX_LENGTH,
  TENANT_OG_DESCRIPTION_MAX_LENGTH,
  TENANT_OG_TITLE_MAX_LENGTH,
  tenantSocialLinkSchema,
} from '#core/domain/index.js';
import type {
  DnsRecord,
  ExemptionBasisKind,
  Language,
  TenantDomainStatus,
  TenantSocialLink,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { ActiveSessions } from '../../../components/ui/ActiveSessions.js';
import { AuthenticationMethods } from '../../../components/ui/AuthenticationMethods.js';
import { ChangePasswordForm } from '../../../components/ui/ChangePasswordForm.js';
import { EmailVerificationStatus } from '../../../components/ui/EmailVerificationStatus.js';
import { errorCodeOf, localizePanelError, serverMessageOf, useLanguage, useTranslations } from '../../../i18n/index.js';
import type { Messages } from '../../../i18n/index.js';
import {
  BUILD_SHA,
  BUILD_VERSION,
  isBuildMismatch,
  shortSha,
} from '../../../lib/build-info.js';
import { formatDateTime } from '../../../lib/format.js';
import { BrandSwatch, Eyebrow } from '../../../theme.js';
import { deriveBrandPalette } from '../../../theme-branding.js';
import { usePanelContext } from '../panel-context.js';
import { ImageAssetField } from '../ImageAssetField.js';

const isExemptionBasisKind = (value: unknown): value is ExemptionBasisKind =>
  value === 'art_113_1' ||
  value === 'art_113_9' ||
  value === 'art_43_1' ||
  value === 'other_statute' ||
  value === 'other';

type SettingsSection = 'company' | 'legal' | 'brand' | 'security' | 'diagnostics';

const settingsSectionFromHash = (hash: string): SettingsSection => {
  switch (hash.replace(/^#/, '')) {
    case 'legal':
      return 'legal';
    case 'brand':
    case 'branding':
      return 'brand';
    case 'security':
    case 'email-verification':
      return 'security';
    case 'diagnostics':
    case 'build':
      return 'diagnostics';
    case 'company':
    case 'support':
    case 'public-access':
    case 'invoice':
    case 'domains':
    default:
      return 'company';
  }
};

const isRetiredBillingHash = (hash: string): boolean => hash.replace(/^#/, '') === 'billing';

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
      title={t.support.settingsHeading}
      description={t.support.settingsIntro}
      actions={canEdit ? (
        <Button type="submit" variant="contained" disabled={update.isPending}>
          {t.support.save}
        </Button>
      ) : undefined}
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
      {update.isError ? <Alert severity="error">{localizePanelError(update.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const EmailLanguageSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<Language | null>(null);
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const stored = settings.data?.settings.defaultLanguage ?? null;
  const value = draft ?? stored ?? DEFAULT_LANGUAGE;
  const unavailable = !settings.isSuccess || update.isPending;
  return (
    <SectionCard
      title={t.emailLanguageSettings.heading}
      description={t.emailLanguageSettings.intro}
      actions={canEdit ? (
        <Button type="submit" variant="contained" disabled={unavailable}>
          {t.emailLanguageSettings.save}
        </Button>
      ) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ defaultLanguage: value });
      }}
    >
      <FormControl fullWidth>
        <FormLabel id="tenant-default-language-label">{t.emailLanguageSettings.label}</FormLabel>
        <Select
          labelId="tenant-default-language-label"
          data-testid="tenant-default-language"
          value={value}
          disabled={!canEdit || unavailable}
          onChange={(event) => setDraft(languageOrDefault(event.target.value))}
        >
          {LANGUAGES.map((option) => (
            <MenuItem key={option} value={option}>{t.emailLanguageSettings.options[option]}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
      {update.isError ? <Alert severity="error">{localizePanelError(update.error, t)}</Alert> : null}
    </SectionCard>
  );
};

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
  const provider = settings.data?.settings.invoicingProvider ?? '';
  const [sellerName, setSellerName] = useState<string | null>(null);
  const [sellerAddress, setSellerAddress] = useState<string | null>(null);

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
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
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
    <SectionCard
      title={t.legal.heading}
      description={t.legal.intro}
      onSubmit={submit}
      actions={canEdit ? (
        <Button
          type="submit"
          variant="contained"
          data-testid="legal-save"
          disabled={updateSettings.isPending || !settings.isSuccess}
        >
          {updateSettings.isPending ? t.legal.saving : t.legal.save}
        </Button>
      ) : undefined}
    >
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
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="legal-saved">
          {t.legal.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const PublicAccessPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const spaces = useQuery(actions.staffSpaces);
  const courses = useQuery(actions.courses);
  const updateSettings = useMutation(actions.updateTenantSettings);
  const updateCourse = useMutation(actions.updateCourse);
  const [homeSpaceDraft, setHomeSpaceDraft] = useState<string | null>(null);
  const [courseDrafts, setCourseDrafts] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  const publicSpaces = (spaces.data?.spaces ?? []).filter(
    (space) => space.publicReadOnly && space.archivedAt === null,
  );
  const storedHomeSpaceId = settings.data?.settings.defaultHomeSpaceId ?? '';
  const homeSpaceId = homeSpaceDraft ?? storedHomeSpaceId;
  const homeSpaceValue = publicSpaces.some((space) => space.id === homeSpaceId) ? homeSpaceId : '';
  const courseList = courses.data?.courses ?? [];
  const publiclyVisible = (course: { id: string; publiclyVisible: boolean }) =>
    courseDrafts[course.id] ?? course.publiclyVisible;
  const changedCourses = courseList.filter(
    (course) => publiclyVisible(course) !== course.publiclyVisible,
  );

  const pending = updateSettings.isPending || updateCourse.isPending;
  const loaded = settings.isSuccess && spaces.isSuccess;

  const submit = async () => {
    setSaved(false);
    try {
      if (homeSpaceDraft !== null) {
        await updateSettings.mutateAsync({
          defaultHomeSpaceId: homeSpaceDraft === '' ? null : homeSpaceDraft,
        });
      }
      for (const course of changedCourses) {
        await updateCourse.mutateAsync({ id: course.id, publiclyVisible: publiclyVisible(course) });
      }
    } catch {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries(actions.tenantSettingsInvalidates()),
      queryClient.invalidateQueries(actions.coursesInvalidates()),
      queryClient.invalidateQueries(actions.publicOfferInvalidates()),
    ]);
    setHomeSpaceDraft(null);
    setCourseDrafts({});
    setSaved(true);
  };

  return (
    <SectionCard
      title={t.publicAccess.heading}
      description={t.publicAccess.intro}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      actions={canEdit ? (
        <Button
          type="submit"
          variant="contained"
          data-testid="public-access-save"
          disabled={!loaded || pending}
        >
          {pending ? t.publicAccess.saving : t.publicAccess.save}
        </Button>
      ) : undefined}
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="public-home-space">{t.publicAccess.homeSpaceLabel}</FormLabel>
        <Select
          id="public-home-space"
          displayEmpty
          value={homeSpaceValue}
          disabled={!canEdit || !loaded || pending}
          inputProps={{ 'aria-label': t.publicAccess.homeSpaceLabel }}
          onChange={(event) => {
            setSaved(false);
            setHomeSpaceDraft(event.target.value);
          }}
        >
          <MenuItem value="">{t.publicAccess.homeSpaceUnset}</MenuItem>
          {publicSpaces.map((space) => (
            <MenuItem key={space.id} value={space.id}>
              {space.name}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" component="p">
          {t.publicAccess.homeSpaceHint}
        </Typography>
      </FormControl>
      <FormControl component="fieldset" variant="standard" data-testid="public-access-courses">
        <FormLabel component="legend">{t.publicAccess.coursesHeading}</FormLabel>
        {courses.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.publicAccess.coursesLoading }} />
        ) : courses.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} />
        ) : courseList.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t.publicAccess.coursesEmpty}</Typography>
        ) : (
          courseList.map((course) => (
            <FormControlLabel
              key={course.id}
              control={(
                <Switch
                  checked={publiclyVisible(course)}
                  disabled={!canEdit || pending}
                  slotProps={{ input: { 'aria-label': course.name } }}
                  data-testid={`public-course-${course.id}`}
                  onChange={(event) => {
                    setSaved(false);
                    setCourseDrafts((current) => ({ ...current, [course.id]: event.target.checked }));
                  }}
                />
              )}
              label={course.name}
            />
          ))
        )}
        <FormHelperText>{t.publicAccess.coursesHint}</FormHelperText>
      </FormControl>
      <FormHelperText data-testid="public-access-status">
        {pending ? t.publicAccess.saving : saved ? t.publicAccess.saved : ' '}
      </FormHelperText>
      {spaces.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }} />
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
      {updateCourse.isError ? <Alert severity="error">{localizePanelError(updateCourse.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const DirectMessagesPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
      await queryClient.invalidateQueries(actions.memberNavigationInvalidates());
    },
  });
  const enabled = settings.data?.settings.directMessagesEnabled !== false;

  return (
    <SectionCard title={t.directMessages.heading} description={t.directMessages.intro}>
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            disabled={!canEdit || !settings.isSuccess || updateSettings.isPending}
            slotProps={{ input: { 'aria-label': t.directMessages.toggleLabel } }}
            data-testid="direct-messages-toggle"
            onChange={(event) => updateSettings.mutate({ directMessagesEnabled: event.target.checked })}
          />
        }
        label={t.directMessages.toggleLabel}
      />
      <FormHelperText data-testid="direct-messages-status">
        {updateSettings.isPending ? t.common.saving : updateSettings.isSuccess ? t.common.saved : ' '}
      </FormHelperText>
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const CharacterCounter = ({
  used,
  limit,
  testId,
}: {
  used: number;
  limit: number;
  testId: string;
}) => {
  const t = useTranslations();
  const atLimit = used >= limit;
  return (
    <Typography
      variant="caption"
      component="p"
      color={atLimit ? 'error' : 'text.secondary'}
      data-testid={testId}
    >
      {atLimit
        ? `${t.branding.charCount({ used, limit })} · ${t.branding.charLimitReached}`
        : t.branding.charCount({ used, limit })}
    </Typography>
  );
};

const BrandingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [name, setName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoDarkUrl, setLogoDarkUrl] = useState<string | null>(null);
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
  const logoDarkValue = logoDarkUrl ?? settings.data?.settings.logoDarkUrl ?? '';
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
      logoDarkUrl: logoDarkValue.trim() === '' ? null : logoDarkValue.trim(),
      accentColor: accent === '' ? null : accent,
      faviconUrl: faviconValue.trim() === '' ? null : faviconValue.trim(),
      ogTitle: ogTitleValue.trim() === '' ? null : ogTitleValue.trim(),
      ogDescription: ogDescriptionValue.trim() === '' ? null : ogDescriptionValue.trim(),
      ogImageUrl: ogImageValue.trim() === '' ? null : ogImageValue.trim(),
    });
  };

  const disabled = !canEdit || !settings.isSuccess;

  return (
    <SectionCard
      title={t.branding.heading}
      description={t.branding.intro}
      onSubmit={submit}
      actions={canEdit ? (
        <Button
          type="submit"
          variant="contained"
          data-testid="branding-save"
          disabled={updateSettings.isPending || !settings.isSuccess}
        >
          {updateSettings.isPending ? t.branding.saving : t.branding.save}
        </Button>
      ) : undefined}
    >
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
          <ImageAssetField
            id="branding-logo-url"
            label={t.branding.logoLabel}
            hint={t.branding.logoHint}
            placeholder={t.branding.logoPlaceholder}
            value={logoValue}
            onChange={setLogoUrl}
            kind="logo"
            disabled={disabled}
            testId="branding-logo-url"
            previewBackground="light"
            removable
          />
          <ImageAssetField
            id="branding-logo-dark-url"
            label={t.branding.logoDarkLabel}
            hint={t.branding.logoDarkHint}
            placeholder={t.branding.logoPlaceholder}
            value={logoDarkValue}
            onChange={setLogoDarkUrl}
            kind="logo-dark"
            disabled={disabled}
            testId="branding-logo-dark-url"
            previewBackground="dark"
            removable
          />
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
          <ImageAssetField
            id="branding-favicon-url"
            label={t.branding.faviconLabel}
            placeholder={t.branding.faviconPlaceholder}
            value={faviconValue}
            onChange={setFaviconUrl}
            kind="favicon"
            disabled={disabled}
            testId="branding-favicon-url"
          />
          <Typography variant="h3" component="h3">{t.branding.profileLinksHeading}</Typography>
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
          <Typography variant="h3" component="h3">{t.branding.socialHeading}</Typography>
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
            <CharacterCounter
              used={ogTitleValue.length}
              limit={TENANT_OG_TITLE_MAX_LENGTH}
              testId="branding-og-title-count"
            />
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
            <CharacterCounter
              used={ogDescriptionValue.length}
              limit={TENANT_OG_DESCRIPTION_MAX_LENGTH}
              testId="branding-og-description-count"
            />
          </FormControl>
          <ImageAssetField
            id="branding-og-image-url"
            label={t.branding.ogImageLabel}
            hint={t.branding.ogImageHint({
              width: SHARE_IMAGE_RECOMMENDED_WIDTH,
              height: SHARE_IMAGE_RECOMMENDED_HEIGHT,
            })}
            value={ogImageValue}
            onChange={setOgImageUrl}
            kind="share-image"
            disabled={disabled}
            testId="branding-og-image-url"
          />
        </>
      )}
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="branding-saved">
          {t.branding.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const SecurityPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { email } = usePanelContext();
  const queryClient = useQueryClient();
  const passkeys = useQuery(actions.passkeys);
  const accountSessions = useQuery(actions.accountSessions);
  const revokeAccountSession = useMutation({
    ...actions.revokeAccountSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
  const revokeOtherAccountSessions = useMutation({
    ...actions.revokeOtherAccountSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.accountSessionsInvalidates());
    },
  });
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
              <Alert severity="error">{localizePanelError(requestPasswordReset.error, t)}</Alert>
            ) : null}
          </Box>
        </Box>

        <AuthenticationMethods
          passkeys={{ data: passkeys.data, pending: passkeys.isPending, error: passkeys.error, retry: () => void passkeys.refetch() }}
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
        <ActiveSessions
          sessions={{
            data: accountSessions.data?.sessions,
            pending: accountSessions.isPending,
            error: accountSessions.error,
            retry: () => void accountSessions.refetch(),
          }}
          revokeSession={{
            pending: revokeAccountSession.isPending,
            success: revokeAccountSession.isSuccess,
            error: revokeAccountSession.error,
            run: revokeAccountSession.mutate,
          }}
          revokeOtherSessions={{
            pending: revokeOtherAccountSessions.isPending,
            success: revokeOtherAccountSessions.isSuccess,
            error: revokeOtherAccountSessions.error,
            run: () => revokeOtherAccountSessions.mutate(undefined),
          }}
        />
      </Stack>
    </SectionCard>
  );
};

const CUSTOM_DOMAIN_DOCS_URL =
  'https://github.com/coderoadpl/togethercommunity-app/blob/main/app/docs/custom-domains.md';

const domainStatusLabel = (t: Messages, status: TenantDomainStatus): string => {
  switch (status) {
    case 'active':
      return t.tenantDomains.statusActive;
    case 'pending-dns':
      return t.tenantDomains.statusPendingDns;
    case 'provider-verification':
      return t.tenantDomains.statusProviderVerification;
    case 'error':
      return t.tenantDomains.statusError;
  }
};

const COPIED_LABEL_MS = 2_000;

const DOMAIN_STATUS_COLOR: Record<TenantDomainStatus, 'success' | 'warning' | 'info' | 'error'> = {
  active: 'success',
  'pending-dns': 'warning',
  'provider-verification': 'info',
  error: 'error',
};

/**
 * A provider refusal and a rejected domain both carry the one sentence that says
 * which domain cannot be connected and why, which the generic copy would drop.
 */
const domainErrorMessage = (error: unknown, t: Messages): string => {
  const code = errorCodeOf(error);
  if (code === 'conflict') return t.tenantDomains.conflict;
  if (code === 'integration_unavailable' || code === 'validation') {
    return serverMessageOf(error) ?? localizePanelError(error, t);
  }
  return localizePanelError(error, t);
};

const DnsRecordRow = ({ record }: { record: DnsRecord }) => {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(record.value);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, COPIED_LABEL_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Stack
      direction="row"
      useFlexGap
      sx={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
      data-testid={`dns-record-${record.type}-${record.name}`}
    >
      <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>
        {t.tenantDomains.recordType}: {record.type} · {t.tenantDomains.recordName}: {record.name}
        {' · '}
        {t.tenantDomains.recordValue}: {record.value}
      </Typography>
      <Button
        type="button"
        size="small"
        onClick={() => void copyValue()}
      >
        {copied ? t.tenantDomains.copied : t.tenantDomains.copy}
      </Button>
    </Stack>
  );
};

const TenantDomainsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const routing = useQuery(actions.tenantRouting);
  const [draft, setDraft] = useState('');
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.tenantRoutingInvalidates());
  };
  const addDomain = useMutation({ ...actions.addTenantDomain, onSuccess: invalidate });
  const checkDomain = useMutation({ ...actions.checkTenantDomain, onSettled: invalidate });
  const removeDomain = useMutation({
    ...actions.removeTenantDomain,
    onSuccess: async (result) => {
      setRedirectTo(result.redirectTo);
      await invalidate();
    },
  });
  const pending = addDomain.isPending || checkDomain.isPending || removeDomain.isPending;
  const busyWith = (
    mutation: { isPending: boolean; variables?: { domain: string } | undefined },
    domain: string,
  ): boolean => mutation.isPending && mutation.variables?.domain === domain;
  const error = addDomain.error ?? checkDomain.error ?? removeDomain.error;

  if (routing.isError) {
    return (
      <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizePanelError(routing.error, t),
            retry: { label: t.common.retry, onRetry: () => void routing.refetch() },
          }}
        />
      </SectionCard>
    );
  }

  if (!routing.isSuccess) {
    return (
      <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
        <StatusView
          surface={false}
          state={{ kind: 'loading', label: t.common.loading }}
          data-testid="tenant-domains-loading"
        />
      </SectionCard>
    );
  }

  const { customDomains, tenantHost, canAddCustomDomain } = routing.data.routing;

  return (
    <SectionCard title={t.tenantDomains.heading} description={t.tenantDomains.intro}>
      <Stack useFlexGap spacing="1rem" data-testid="tenant-domains">
        <Stack useFlexGap spacing="0.3rem">
          <Eyebrow>{t.tenantDomains.workspaceAddress}</Eyebrow>
          <Typography variant="body2">{tenantHost}</Typography>
        </Stack>
        {customDomains.some((entry) => entry.verified) ? null : (
          <Alert severity="warning" data-testid="tenant-domain-warning">
            {t.tenantDomains.firstDomainWarning}
            {' '}
            <MuiLink href={CUSTOM_DOMAIN_DOCS_URL} target="_blank" rel="noreferrer">
              {t.tenantDomains.docsLink}
            </MuiLink>
          </Alert>
        )}
        {error === null ? null : (
          <Alert severity="error" data-testid="tenant-domain-error">
            {domainErrorMessage(error, t)}
          </Alert>
        )}
        {redirectTo === null ? null : (
          <Alert severity="info" data-testid="tenant-domain-redirect">
            {t.tenantDomains.removedRedirect}
            {' '}
            <MuiLink href={redirectTo}>{redirectTo}</MuiLink>
          </Alert>
        )}
        <Stack useFlexGap spacing="0.3rem">
          <Eyebrow>{t.tenantDomains.customDomains}</Eyebrow>
          {customDomains.length === 0 ? (
            <Typography variant="body2">{t.tenantDomains.none}</Typography>
          ) : customDomains.map((entry) => (
            <Stack key={entry.domain} useFlexGap spacing="0.4rem" data-testid={`tenant-domain-${entry.domain}`}>
              <Stack direction="row" useFlexGap sx={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2">{entry.domain}</Typography>
                <Chip
                  size="small"
                  color={DOMAIN_STATUS_COLOR[entry.status]}
                  label={domainStatusLabel(t, entry.status)}
                  data-testid={`tenant-domain-status-${entry.domain}`}
                />
                <Button
                  type="button"
                  size="small"
                  disabled={!canEdit || pending}
                  onClick={() => checkDomain.mutate({ domain: entry.domain })}
                  data-testid={`tenant-domain-check-${entry.domain}`}
                >
                  {busyWith(checkDomain, entry.domain)
                    ? t.tenantDomains.checking
                    : t.tenantDomains.check}
                </Button>
                <Button
                  type="button"
                  size="small"
                  color="error"
                  disabled={!canEdit || pending}
                  onClick={() => {
                    if (!window.confirm(t.tenantDomains.removeConfirm({ domain: entry.domain }))) return;
                    removeDomain.mutate({ domain: entry.domain });
                  }}
                  data-testid={`tenant-domain-remove-${entry.domain}`}
                >
                  {busyWith(removeDomain, entry.domain)
                    ? t.tenantDomains.removing
                    : t.tenantDomains.remove}
                </Button>
              </Stack>
              {entry.lastError === null ? null : (
                <Typography variant="caption" color="error">{entry.lastError}</Typography>
              )}
              {entry.verified ? null : (
                <>
                  <Typography variant="caption">{t.tenantDomains.recordsHeading}</Typography>
                  {entry.records.map((record) => (
                    <DnsRecordRow key={`${record.type}-${record.name}`} record={record} />
                  ))}
                </>
              )}
              {entry.lastCheckedAt === null ? null : (
                <Typography variant="caption">
                  {t.tenantDomains.lastChecked({ at: formatDateTime(entry.lastCheckedAt, language) })}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
        {canAddCustomDomain ? (
          <Stack
            component="form"
            useFlexGap
            spacing="0.5rem"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              addDomain.mutate({ domain: draft }, { onSuccess: () => setDraft('') });
            }}
          >
            <FormControl>
              <FormLabel htmlFor="tenant-domain-input">{t.tenantDomains.addLabel}</FormLabel>
              <OutlinedInput
                id="tenant-domain-input"
                value={draft}
                disabled={!canEdit}
                placeholder={t.tenantDomains.addPlaceholder}
                onChange={(event) => setDraft(event.target.value)}
                inputProps={{ 'data-testid': 'tenant-domain-input' }}
              />
            </FormControl>
            <Button
              type="submit"
              variant="contained"
              disabled={!canEdit || pending || draft.trim().length === 0}
              data-testid="tenant-domain-add"
            >
              {addDomain.isPending ? t.tenantDomains.adding : t.tenantDomains.add}
            </Button>
          </Stack>
        ) : (
          <Typography variant="body2" data-testid="tenant-domain-limit">
            {t.tenantDomains.limitReached({ max: MAX_CUSTOM_DOMAINS_PER_TENANT })}
          </Typography>
        )}
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
      {health.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(health.error, t), retry: { label: t.common.retry, onRetry: () => void health.refetch() } }} /> : null}
      {mismatch ? (
        <Alert severity="warning" data-testid="build-mismatch-warning">
          {t.buildInfo.mismatch}
        </Alert>
      ) : null}
    </SectionCard>
  );
};

const EmailVerificationPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { email, emailVerified } = usePanelContext();
  const resendVerification = useMutation(actions.sendVerificationEmail);
  return (
    <SectionCard title={t.emailVerification.heading}>
      <EmailVerificationStatus
        email={email}
        emailVerified={emailVerified}
        resendPending={resendVerification.isPending}
        resendSent={resendVerification.isSuccess}
        resendError={resendVerification.isError}
        onResend={() => resendVerification.mutate({
          email,
          callbackURL: new URL('/login?verification=verified', window.location.origin).toString(),
          language,
        })}
      />
    </SectionCard>
  );
};

export const SettingsPanel = () => {
  const { tenant } = usePanelContext();
  const t = useTranslations();
  const navigate = useNavigate();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const canEdit = tenant.staffRole === 'owner';

  const changeSection = (_event: SyntheticEvent, value: SettingsSection) => {
    void navigate({ hash: value, replace: true });
  };

  if (isRetiredBillingHash(hash)) {
    return <Navigate to="/panel/integrations" hash="stripe" replace />;
  }

  const section = settingsSectionFromHash(hash);

  return (
    <PanelPage title={t.sections.settings}>
      <Tabs
        value={section}
        onChange={changeSection}
        aria-label={t.settingsNavigation.aria}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ '& .MuiTabs-scrollButtons.Mui-disabled': { width: 0, minWidth: 0, opacity: 0 } }}
      >
        <Tab id="settings-tab-company" aria-controls="settings-panel-company" value="company" label={t.settingsNavigation.company} />
        <Tab id="settings-tab-legal" aria-controls="settings-panel-legal" value="legal" label={t.settingsNavigation.legal} />
        <Tab id="settings-tab-brand" aria-controls="settings-panel-brand" value="brand" label={t.settingsNavigation.brand} />
        <Tab id="settings-tab-security" aria-controls="settings-panel-security" value="security" label={t.settingsNavigation.security} />
        <Tab id="settings-tab-diagnostics" aria-controls="settings-panel-diagnostics" value="diagnostics" label={t.settingsNavigation.diagnostics} />
      </Tabs>

      {section === 'company' ? (
        <Stack id="settings-panel-company" role="tabpanel" aria-labelledby="settings-tab-company" useFlexGap spacing="1.5rem">
          <Box id="support" sx={{ scrollMarginTop: '1rem' }}>
            <SupportSettingsPanel canEdit={canEdit} />
          </Box>
          <Box id="email-language" sx={{ scrollMarginTop: '1rem' }}>
            <EmailLanguageSettingsPanel canEdit={canEdit} />
          </Box>
          <Box id="public-access" sx={{ scrollMarginTop: '1rem' }}>
            <PublicAccessPanel canEdit={canEdit} />
          </Box>
          <Box id="direct-messages" sx={{ scrollMarginTop: '1rem' }}>
            <DirectMessagesPanel canEdit={canEdit} />
          </Box>
          <Box id="invoice" sx={{ scrollMarginTop: '1rem' }}>
            <InvoiceSettingsPanel canEdit={canEdit} />
          </Box>
          <Box id="domains" sx={{ scrollMarginTop: '1rem' }}>
            <TenantDomainsPanel canEdit={canEdit} />
          </Box>
        </Stack>
      ) : null}
      {section === 'legal' ? (
        <Box id="settings-panel-legal" role="tabpanel" aria-labelledby="settings-tab-legal">
          <LegalSettingsPanel canEdit={canEdit} />
        </Box>
      ) : null}
      {section === 'brand' ? (
        <Box id="settings-panel-brand" role="tabpanel" aria-labelledby="settings-tab-brand">
          <BrandingSettingsPanel canEdit={canEdit} />
        </Box>
      ) : null}
      {section === 'security' ? (
        <Stack id="settings-panel-security" role="tabpanel" aria-labelledby="settings-tab-security" useFlexGap spacing="1.5rem">
          <Box id="email-verification" sx={{ scrollMarginTop: '1rem' }}>
            <EmailVerificationPanel />
          </Box>
          <SecurityPanel />
        </Stack>
      ) : null}
      {section === 'diagnostics' ? (
        <Box id="settings-panel-diagnostics" role="tabpanel" aria-labelledby="settings-tab-diagnostics">
          <BuildInfoPanel />
        </Box>
      ) : null}
    </PanelPage>
  );
};
