import { z } from 'zod';

const videoBlockV7Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

type VideoEmbedProviderV7 = 'youtube' | 'vimeo';

type VideoEmbedUrlInspectionV7 =
  | { kind: 'supported'; provider: VideoEmbedProviderV7; embedUrl: string }
  | { kind: 'invalid-provider'; provider: VideoEmbedProviderV7 }
  | { kind: 'unsupported' }
  | { kind: 'invalid-url' };

const youtubeHostsV7 = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const vimeoHostsV7 = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const youtubeVideoIdV7Schema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const vimeoVideoIdV7Schema = z.string().regex(/^\d+$/);
const vimeoPrivacyHashV7Schema = z.string().regex(/^[A-Fa-f0-9]{6,16}$/);

const youtubeVideoIdV7 = (url: URL): string | null => {
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (url.hostname === 'youtu.be') return segments.length === 1 ? segments[0] ?? null : null;
  if (segments.length === 0) return null;
  if (segments[0] === 'watch') return segments.length === 1 ? url.searchParams.get('v') : null;
  if (segments[0] === 'embed' || segments[0] === 'shorts' || segments[0] === 'live') {
    const videoId = segments.length === 2 ? segments[1] ?? null : null;
    return videoId === 'videoseries' ? null : videoId;
  }
  return null;
};

const inspectYoutubeUrlV7 = (url: URL): VideoEmbedUrlInspectionV7 => {
  const videoId = youtubeVideoIdV7(url);
  if (!youtubeVideoIdV7Schema.safeParse(videoId).success) {
    return { kind: 'invalid-provider', provider: 'youtube' };
  }
  return {
    kind: 'supported',
    provider: 'youtube',
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
};

const inspectVimeoUrlV7 = (url: URL): VideoEmbedUrlInspectionV7 => {
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const playerUrl = url.hostname === 'player.vimeo.com';
  const channelUrl = segments[0] === 'channels' && segments.length === 3;
  const groupUrl = segments[0] === 'groups' && segments[2] === 'videos' && segments.length === 4;
  const videoId = playerUrl
    ? segments[0] === 'video' && segments.length === 2
      ? segments[1]
      : undefined
    : channelUrl
      ? segments[2]
      : groupUrl
        ? segments[3]
        : segments.length === 1 || segments.length === 2
          ? segments[0]
          : undefined;
  const pathPrivacyHash = !playerUrl && segments.length === 2 ? segments[1] : undefined;
  const privacyHash = url.searchParams.get('h') ?? pathPrivacyHash;
  const validPrivacyHash =
    privacyHash === null ||
    privacyHash === undefined ||
    vimeoPrivacyHashV7Schema.safeParse(privacyHash).success;
  if (!vimeoVideoIdV7Schema.safeParse(videoId).success || !validPrivacyHash) {
    return { kind: 'invalid-provider', provider: 'vimeo' };
  }
  const embedUrl = new URL(`https://player.vimeo.com/video/${videoId}`);
  if (privacyHash !== null && privacyHash !== undefined) embedUrl.searchParams.set('h', privacyHash);
  return { kind: 'supported', provider: 'vimeo', embedUrl: embedUrl.toString() };
};

const inspectVideoEmbedUrlV7 = (value: string): VideoEmbedUrlInspectionV7 => {
  const parsed = z.string().url().safeParse(value);
  if (!parsed.success) return { kind: 'invalid-url' };
  const url = new URL(parsed.data);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid-url' };
  const hostname = url.hostname.toLowerCase();
  if (youtubeHostsV7.has(hostname)) return inspectYoutubeUrlV7(url);
  if (vimeoHostsV7.has(hostname)) return inspectVimeoUrlV7(url);
  return { kind: 'unsupported' };
};

const videoEmbedUrlV7Message = {
  'invalid-url': 'Must be an absolute http(s) video or embed URL',
  youtube: 'Must be a YouTube watch, youtu.be, Shorts, live or embed URL with an 11-character video id',
  vimeo: 'Must be a Vimeo video, channel, group or player URL with a numeric video id',
} as const;

const videoEmbedUrlV7Schema = z.string().url().transform((value, ctx) => {
  const inspection = inspectVideoEmbedUrlV7(value);
  if (inspection.kind === 'supported') return inspection.embedUrl;
  if (inspection.kind === 'unsupported') return value;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      inspection.kind === 'invalid-url'
        ? videoEmbedUrlV7Message['invalid-url']
        : videoEmbedUrlV7Message[inspection.provider],
  });
  return z.NEVER;
});

const embedBlockV7Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: videoEmbedUrlV7Schema,
    collapsed: z.boolean().optional(),
  })
  .strict();

const absoluteHttpUrlV7Schema = z.string().url().regex(/^https?:\/\//iu);
const sameOriginPathV7Pattern = /^\/(?![/\\])[^\s\\]+$/u;

const documentUrlV7Schema = z
  .string()
  .trim()
  .refine(
    (value) =>
      absoluteHttpUrlV7Schema.safeParse(value).success || sameOriginPathV7Pattern.test(value),
    'Must be an absolute http(s) URL or a same-origin path starting with "/"',
  );

const linkUrlV7Schema = z
  .string()
  .trim()
  .url()
  .regex(/^(?:https?:\/\/|mailto:)/iu, 'Link URL must use HTTP, HTTPS or mailto');

const pdfBlockV7Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlV7Schema,
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV7Schema = z
  .object({
    type: z.literal('link'),
    url: linkUrlV7Schema,
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV7Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV7Schema = z.discriminatedUnion('type', [
  videoBlockV7Schema,
  embedBlockV7Schema,
  pdfBlockV7Schema,
  linkBlockV7Schema,
  htmlBlockV7Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 7. Adds the
 * optional `collapsed` flag on embed blocks.
 */
export const courseLessonSnapshotV7Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  isPreview: z.boolean().default(false),
  contents: z.array(lessonBlockV7Schema),
  durationMinutes: z.number().int().positive().optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV7 = z.infer<typeof courseLessonSnapshotV7Schema>;
