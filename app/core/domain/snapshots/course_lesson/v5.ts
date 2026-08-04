import { z } from 'zod';

const videoBlockV5Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

type VideoEmbedProviderV5 = 'youtube' | 'vimeo';

type VideoEmbedUrlInspectionV5 =
  | { kind: 'supported'; provider: VideoEmbedProviderV5; embedUrl: string }
  | { kind: 'invalid-provider'; provider: VideoEmbedProviderV5 }
  | { kind: 'unsupported' }
  | { kind: 'invalid-url' };

const youtubeHostsV5 = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const vimeoHostsV5 = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const youtubeVideoIdV5Schema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const vimeoVideoIdV5Schema = z.string().regex(/^\d+$/);
const vimeoPrivacyHashV5Schema = z.string().regex(/^[A-Fa-f0-9]{6,16}$/);

const youtubeVideoIdV5 = (url: URL): string | null => {
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

const inspectYoutubeUrlV5 = (url: URL): VideoEmbedUrlInspectionV5 => {
  const videoId = youtubeVideoIdV5(url);
  if (!youtubeVideoIdV5Schema.safeParse(videoId).success) {
    return { kind: 'invalid-provider', provider: 'youtube' };
  }
  return {
    kind: 'supported',
    provider: 'youtube',
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
};

const inspectVimeoUrlV5 = (url: URL): VideoEmbedUrlInspectionV5 => {
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
    vimeoPrivacyHashV5Schema.safeParse(privacyHash).success;
  if (!vimeoVideoIdV5Schema.safeParse(videoId).success || !validPrivacyHash) {
    return { kind: 'invalid-provider', provider: 'vimeo' };
  }
  const embedUrl = new URL(`https://player.vimeo.com/video/${videoId}`);
  if (privacyHash !== null && privacyHash !== undefined) embedUrl.searchParams.set('h', privacyHash);
  return { kind: 'supported', provider: 'vimeo', embedUrl: embedUrl.toString() };
};

const inspectVideoEmbedUrlV5 = (value: string): VideoEmbedUrlInspectionV5 => {
  const parsed = z.string().url().safeParse(value);
  if (!parsed.success) return { kind: 'invalid-url' };
  const url = new URL(parsed.data);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid-url' };
  const hostname = url.hostname.toLowerCase();
  if (youtubeHostsV5.has(hostname)) return inspectYoutubeUrlV5(url);
  if (vimeoHostsV5.has(hostname)) return inspectVimeoUrlV5(url);
  return { kind: 'unsupported' };
};

export const upcastLegacyVideoEmbedUrlV5 = (value: string): string => {
  const inspection = inspectVideoEmbedUrlV5(value);
  if (inspection.kind === 'supported') return inspection.embedUrl;
  if (inspection.kind === 'unsupported') return value;
  return `https://legacy-embed.invalid/?url=${encodeURIComponent(value)}`;
};

const videoEmbedUrlV5Message = {
  'invalid-url': 'Must be an absolute http(s) video or embed URL',
  youtube: 'Must be a YouTube watch, youtu.be, Shorts, live or embed URL with an 11-character video id',
  vimeo: 'Must be a Vimeo video, channel, group or player URL with a numeric video id',
} as const;

const videoEmbedUrlV5Schema = z.string().url().transform((value, ctx) => {
  const inspection = inspectVideoEmbedUrlV5(value);
  if (inspection.kind === 'supported') return inspection.embedUrl;
  if (inspection.kind === 'unsupported') return value;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      inspection.kind === 'invalid-url'
        ? videoEmbedUrlV5Message['invalid-url']
        : videoEmbedUrlV5Message[inspection.provider],
  });
  return z.NEVER;
});

const embedBlockV5Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: videoEmbedUrlV5Schema,
  })
  .strict();

const documentUrlV5Schema = z
  .string()
  .refine(
    (value) => value.startsWith('/') || z.string().url().safeParse(value).success,
    'Must be an absolute URL or a same-origin path starting with "/"',
  );

const pdfBlockV5Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlV5Schema,
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV5Schema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV5Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV5Schema = z.discriminatedUnion('type', [
  videoBlockV5Schema,
  embedBlockV5Schema,
  pdfBlockV5Schema,
  linkBlockV5Schema,
  htmlBlockV5Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 5. Adds the
 * anonymous-preview flag to the provider-normalized v4 lesson shape.
 */
export const courseLessonSnapshotV5Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  isPreview: z.boolean().default(false),
  contents: z.array(lessonBlockV5Schema),
  durationMinutes: z.number().int().positive().optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV5 = z.infer<typeof courseLessonSnapshotV5Schema>;
