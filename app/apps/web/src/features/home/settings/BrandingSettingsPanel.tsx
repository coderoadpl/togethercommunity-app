import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accentColorSchema,
  deriveLightAccent,
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
  TenantSocialLink,
} from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { BrandSchemePreview, BrandPreviewControl, BrandSwatch } from '../../../theme.js';
import { deriveBrandPalette } from '../../../theme-branding.js';
import { ImageAssetField } from '../ImageAssetField.js';

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

export const BrandingSettingsPanel = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [name, setName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoDarkUrl, setLogoDarkUrl] = useState<string | null>(null);
  const [accentLight, setAccentLight] = useState<string | null>(null);
  const [accentLightError, setAccentLightError] = useState(false);
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
  const accentLightValue = accentLight ?? settings.data?.settings.accentLight ?? '';
  const accentLightValid = accentColorSchema.safeParse(accentLightValue.trim()).success;
  const accentValue = accentColor ?? settings.data?.settings.accentColor ?? '';
  const faviconValue = faviconUrl ?? settings.data?.settings.faviconUrl ?? '';
  const ogTitleValue = ogTitle ?? settings.data?.settings.ogTitle ?? '';
  const ogDescriptionValue = ogDescription ?? settings.data?.settings.ogDescription ?? '';
  const ogImageValue = ogImageUrl ?? settings.data?.settings.ogImageUrl ?? '';
  const socialLinksValue = socialLinks ?? settings.data?.settings.socialLinks ?? [];
  const accentValid = accentColorSchema.safeParse(accentValue.trim()).success;
  const swatch = accentValid ? deriveBrandPalette(accentValue.trim(), 'dark') : null;
  const derivedLight = accentValid ? deriveLightAccent(accentValue.trim()) : '';
  const lightPreview = accentLightValid ? accentLightValue.trim() : derivedLight;
  const lightSwatch = lightPreview === '' ? null : deriveBrandPalette(lightPreview);
  const schemePreviews = [
    { label: t.branding.darkPreview, scheme: 'dark' as const, palette: swatch },
    { label: t.branding.lightPreview, scheme: 'light' as const, palette: lightSwatch },
  ];

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
    const light = accentLightValue.trim();
    if (light !== '' && !accentLightValid) {
      setAccentLightError(true);
      return;
    }
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
      accentLight: light === '' ? null : light,
      faviconUrl: faviconValue.trim() === '' ? null : faviconValue.trim(),
      ogTitle: ogTitleValue.trim() === '' ? null : ogTitleValue.trim(),
      ogDescription: ogDescriptionValue.trim() === '' ? null : ogDescriptionValue.trim(),
      ogImageUrl: ogImageValue.trim() === '' ? null : ogImageValue.trim(),
    });
  };

  const disabled = !canEdit || !settings.isSuccess;
  useToastOutcome(
    updateSettings.isSuccess,
    t.branding.saved,
    updateSettings.error === null ? null : localizePanelError(updateSettings.error, t),
  );

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
          sx={{ minHeight: 44, minWidth: 44 }}
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
                sx={{ maxWidth: '11rem', minHeight: 44 }}
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
          <FormControl fullWidth error={accentLightError}>
            <FormLabel htmlFor="branding-accent-light">{t.branding.accentLightLabel}</FormLabel>
            <OutlinedInput
              id="branding-accent-light"
              value={accentLightValue}
              disabled={disabled}
              onChange={(event) => {
                setAccentLight(event.target.value);
                setAccentLightError(false);
              }}
              inputProps={{ 'data-testid': 'branding-accent-light' }}
              sx={{ maxWidth: '11rem', minHeight: 44 }}
            />
            <Typography variant="caption" component="p">
              {accentLightError ? t.branding.accentInvalid : t.branding.accentLightHint}
              {accentLightValue.trim() === '' && derivedLight !== '' ? ` ${derivedLight}` : ''}
            </Typography>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap sx={{ gap: 1 }}>
            {schemePreviews.map(({ label, scheme, palette }) => palette === null ? null : (
              <BrandSchemePreview key={label} scheme={scheme} accent={palette.dark}>
                <Typography>{label}</Typography>
                <BrandPreviewControl accent={palette.main} ink={palette.contrastText}>
                  {t.branding.previewAction}
                </BrandPreviewControl>
              </BrandSchemePreview>
            ))}
          </Stack>
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
    </SectionCard>
  );
};
