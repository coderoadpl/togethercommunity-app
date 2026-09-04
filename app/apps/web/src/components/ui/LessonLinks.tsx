import { Box, Link as MuiLink, Stack, Typography } from '@mui/material';
import { type Breakpoint } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';
import { LessonBlockIcon, LessonLinkButton, LESSON_SANDBOX_FRAME_SX } from '../../theme.js';
import { LessonMediaEmbed } from './LessonMedia.js';

const SANDBOX_PERMISSIONS = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals';

const GithubIcon = () => (
  <LessonBlockIcon aria-hidden data-testid="link-icon-github" viewBox="0 0 24 24">
    <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
  </LessonBlockIcon>
);

const ExternalLinkIcon = () => (
  <LessonBlockIcon aria-hidden data-testid="link-icon-external" viewBox="0 0 24 24">
    <path d="M14 3v2h3.6l-8.3 8.3 1.4 1.4L19 6.4V10h2V3h-7zM5 5h5V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-2v5H5V5z" />
  </LessonBlockIcon>
);

export type LessonLinkItem = { url: string; label: string; host: string };

const isGithub = (host: string): boolean => host === 'github.com' || host.endsWith('.github.com');

const isMailto = (url: string): boolean => url.toLowerCase().startsWith('mailto:');

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

export const LessonLinkList = ({ links }: { links: readonly LessonLinkItem[] }) => {
  const t = useTranslations();
  return (
    <Stack
      component="ul"
      role="list"
      direction="row"
      useFlexGap
      sx={{
        flexWrap: 'wrap',
        columnGap: '0.75rem',
        rowGap: '0.75rem',
        minWidth: 0,
        listStyle: 'none',
        m: 0,
        p: 0,
      }}
      data-testid="lesson-links"
    >
      {links.map((link, index) => (
        <Box
          component="li"
          role="listitem"
          key={`${index}-${link.url}`}
          sx={{ minWidth: 0, maxWidth: '100%' }}
        >
          <LessonLinkButton
            component="a"
            href={link.url}
            {...(isMailto(link.url) ? {} : NEW_TAB)}
            variant="outlined"
            title={link.url}
            aria-label={`${link.label} ${isMailto(link.url) ? t.lesson.mailHint : t.lesson.newTabHint}`}
            startIcon={isGithub(link.host) ? <GithubIcon /> : <ExternalLinkIcon />}
          >
            {link.label}
          </LessonLinkButton>
        </Box>
      ))}
    </Stack>
  );
};

const lastPathSegment = (value: string): string | null => {
  try {
    const segments = new URL(value).pathname.split('/').filter((segment) => segment.length > 0);
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
};

const sandboxTitle = (providerName: string, canonicalUrl: string, caption: string | null): string => {
  if (caption !== null) return caption;
  const segment = lastPathSegment(canonicalUrl);
  return segment === null ? providerName : `${providerName} / ${segment}`;
};

type ResponsiveLength = string | number | Partial<Record<Breakpoint, string | number>>;

export const LessonSandboxEmbed = ({
  embedUrl,
  canonicalUrl,
  providerName,
  caption,
  outdentX = 0,
}: {
  embedUrl: string;
  canonicalUrl: string;
  providerName: string;
  caption: string | null;
  outdentX?: ResponsiveLength;
}) => {
  const t = useTranslations();
  const title = sandboxTitle(providerName, canonicalUrl, caption);
  return (
    <Stack useFlexGap spacing="0.5rem" sx={{ minWidth: 0 }}>
      {caption === null ? null : (
        <Typography variant="subtitle1" component="p" data-testid="lesson-sandbox-caption">
          {caption}
        </Typography>
      )}
      <LessonMediaEmbed
        frameSx={{ ...LESSON_SANDBOX_FRAME_SX, mx: outdentX }}
        data-testid="lesson-sandbox"
        src={embedUrl}
        title={title}
        sandbox={SANDBOX_PERMISSIONS}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
      <Box>
        <MuiLink
          href={canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          underline="always"
          title={canonicalUrl}
          aria-label={`${t.lesson.openInNewTab} — ${title}`}
        >
          {t.lesson.openInNewTab}
        </MuiLink>
      </Box>
    </Stack>
  );
};
