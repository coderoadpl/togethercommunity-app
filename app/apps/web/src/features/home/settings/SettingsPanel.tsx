import { useState, type FormEvent, type SyntheticEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
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
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  DEFAULT_LANGUAGE,
  languageOrDefault,
  LANGUAGES,
} from '#core/domain/index.js';
import type {
  Language,
} from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { EmailVerificationStatus } from '../../../components/ui/EmailVerificationStatus.js';
import { useToast, useToastError, useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import {
  BUILD_SHA,
  BUILD_VERSION,
  isBuildMismatch,
  shortSha,
} from '../../../lib/build-info.js';
import { usePanelContext } from '../panel-context.js';
import { AnalyticsSettingsPanel } from './AnalyticsSettingsPanel.js';
import { ShippingSettingsPanel } from './ShippingSettingsPanel.js';
import { ShipxSettingsCard } from './ShipxSettingsCard.js';
import { TeamSettingsPanel } from './TeamSettingsPanel.js';
import { InvoiceSettingsPanel } from './InvoiceSettingsPanel.js';
import { BrandingSettingsPanel } from './BrandingSettingsPanel.js';
import { SecurityPanel } from './SecurityPanel.js';
import { TenantDomainsPanel } from './TenantDomainsPanel.js';

type SettingsSection = 'company' | 'legal' | 'brand' | 'analytics' | 'shipping' | 'security' | 'diagnostics';

const settingsSectionFromHash = (hash: string): SettingsSection => {
  switch (hash.replace(/^#/, '')) {
    case 'legal':
      return 'legal';
    case 'brand':
    case 'branding':
      return 'brand';
    case 'analytics':
      return 'analytics';
    case 'shipping':
      return 'shipping';
    case 'team':
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

const SignInNoticeSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<{ enabled: boolean; text: string } | null>(null);
  const value = draft ?? settings.data?.settings.signInNotice ?? { enabled: false, text: '' };
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
      await queryClient.invalidateQueries(actions.publicOfferInvalidates());
      setDraft(null);
    },
  });
  const unavailable = !settings.isSuccess || update.isPending;
  useToastOutcome(update.isSuccess, t.common.saved, update.error === null ? null : localizePanelError(update.error, t));
  return (
    <SectionCard
      title={t.signInNoticeSettings.heading}
      actions={canEdit ? <Button type="submit" variant="contained" disabled={unavailable}>{t.signInNoticeSettings.save}</Button> : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ signInNotice: value });
      }}
    >
      <FormControlLabel
        label={t.signInNoticeSettings.enabled}
        control={<Switch checked={value.enabled} disabled={!canEdit || unavailable} onChange={(_, enabled) => setDraft({ ...value, enabled })} />}
      />
      <FormControl fullWidth>
        <FormLabel htmlFor="sign-in-notice-text">{t.signInNoticeSettings.label}</FormLabel>
        <OutlinedInput
          id="sign-in-notice-text"
          multiline
          minRows={3}
          value={value.text}
          disabled={!canEdit || unavailable}
          inputProps={{ maxLength: 600, 'aria-describedby': 'sign-in-notice-helper sign-in-notice-counter' }}
          onChange={(event) => setDraft({ ...value, text: event.target.value })}
        />
        <FormHelperText id="sign-in-notice-helper">{t.signInNoticeSettings.helper}</FormHelperText>
        <FormHelperText id="sign-in-notice-counter">{t.signInNoticeSettings.counter({ count: value.text.length })}</FormHelperText>
      </FormControl>
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
  useToastOutcome(
    update.isSuccess,
    t.common.saved,
    update.error === null ? null : localizePanelError(update.error, t),
  );
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
  useToastOutcome(
    update.isSuccess,
    t.common.saved,
    update.error === null ? null : localizePanelError(update.error, t),
  );
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
  useToastOutcome(
    updateSettings.isSuccess,
    t.legal.saved,
    updateSettings.error === null ? null : localizePanelError(updateSettings.error, t),
  );

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
  useToastOutcome(
    saved,
    t.publicAccess.saved,
    updateSettings.error === null ? null : localizePanelError(updateSettings.error, t),
  );
  useToastError(updateCourse.error === null ? null : localizePanelError(updateCourse.error, t));

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
        {pending ? t.publicAccess.saving : ' '}
      </FormHelperText>
      {spaces.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(spaces.error, t), retry: { label: t.common.retry, onRetry: () => void spaces.refetch() } }} />
      ) : null}
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
  useToastOutcome(
    updateSettings.isSuccess,
    t.common.saved,
    updateSettings.error === null ? null : localizePanelError(updateSettings.error, t),
  );

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
        {updateSettings.isPending ? t.common.saving : ' '}
      </FormHelperText>
    </SectionCard>
  );
};

const VideoPlaybackPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const disabled = !canEdit || !settings.isSuccess || updateSettings.isPending;
  const videoAutoplayDefault = settings.data?.settings.videoAutoplayDefault ?? false;
  const memberVideoAutoplayOverride = settings.data?.settings.memberVideoAutoplayOverride ?? false;

  return (
    <SectionCard title={t.videoPlayback.heading} description={t.videoPlayback.intro}>
      <FormControlLabel
        control={(
          <Switch
            checked={videoAutoplayDefault}
            disabled={disabled}
            onChange={(event) => updateSettings.mutate({ videoAutoplayDefault: event.target.checked })}
          />
        )}
        label={t.videoPlayback.defaultLabel}
      />
      <FormHelperText>{t.videoPlayback.defaultHint}</FormHelperText>
      <FormControlLabel
        control={(
          <Switch
            checked={memberVideoAutoplayOverride}
            disabled={disabled}
            onChange={(event) => updateSettings.mutate({ memberVideoAutoplayOverride: event.target.checked })}
          />
        )}
        label={t.videoPlayback.overrideLabel}
      />
      <FormHelperText>{t.videoPlayback.overrideHint}</FormHelperText>
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
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
  const toast = useToast();
  const resendVerification = useMutation({
    ...actions.sendVerificationEmail,
    onSuccess: () => {
      toast.success(t.emailVerification.sent);
    },
    onError: () => {
      toast.error(t.emailVerification.providerError);
    },
  });
  return (
    <SectionCard title={t.emailVerification.heading}>
      <EmailVerificationStatus
        email={email}
        emailVerified={emailVerified}
        resendPending={resendVerification.isPending}
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
        <Tab id="settings-tab-analytics" aria-controls="settings-panel-analytics" value="analytics" label={t.analyticsSettings.heading} />
        <Tab id="settings-tab-shipping" aria-controls="settings-panel-shipping" value="shipping" label={t.shipping.settingsHeading} />
        <Tab id="settings-tab-security" aria-controls="settings-panel-security" value="security" label={t.settingsNavigation.security} />
        <Tab id="settings-tab-diagnostics" aria-controls="settings-panel-diagnostics" value="diagnostics" label={t.settingsNavigation.diagnostics} />
      </Tabs>

      {section === 'company' ? (
        <Stack id="settings-panel-company" role="tabpanel" aria-labelledby="settings-tab-company" useFlexGap spacing="1.5rem">
          <Box id="sign-in" sx={{ scrollMarginTop: '1rem' }}>
            <SignInNoticeSettingsPanel canEdit={canEdit} />
          </Box>
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
          <Box id="video-playback" sx={{ scrollMarginTop: '1rem' }}>
            <VideoPlaybackPanel canEdit={canEdit} />
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
      {section === 'analytics' ? (
        <Box id="settings-panel-analytics" role="tabpanel" aria-labelledby="settings-tab-analytics">
          <AnalyticsSettingsPanel canEdit={canEdit} />
        </Box>
      ) : null}
      {section === 'shipping' ? (
        <Stack id="settings-panel-shipping" role="tabpanel" aria-labelledby="settings-tab-shipping" useFlexGap spacing="1.5rem">
          <ShippingSettingsPanel canEdit={canEdit} />
          <ShipxSettingsCard canEdit={canEdit} />
        </Stack>
      ) : null}
      {section === 'security' ? (
        <Stack id="settings-panel-security" role="tabpanel" aria-labelledby="settings-tab-security" useFlexGap spacing="1.5rem">
          {canEdit ? <Box id="team"><TeamSettingsPanel /></Box> : null}
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
