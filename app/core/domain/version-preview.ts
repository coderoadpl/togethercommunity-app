import { z } from 'zod';

import { internal, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';
import {
  SNAPSHOT_CURRENT_SCHEMAS,
  snapshotPayloadsEqual,
  type EntityKind,
} from './versioning.js';

/**
 * A snapshot rendered as the fields its edit form shows, so a stored version
 * and the live entity can be displayed side by side and compared field by
 * field without either side knowing the storage shape.
 */

const VERSION_PREVIEW_FIELDS = [
  'title',
  'description',
  'imageUrl',
  'publiclyVisible',
  'modules',
  'prefix',
  'chapters',
  'blocks',
  'price',
] as const;

export const versionPreviewFieldNameSchema = z.enum(VERSION_PREVIEW_FIELDS);

export type VersionPreviewFieldName = z.infer<typeof versionPreviewFieldNameSchema>;

const LESSON_BLOCK_TYPES = ['video', 'embed', 'pdf', 'link', 'html'] as const;

export type LessonBlockType = (typeof LESSON_BLOCK_TYPES)[number];

const versionPreviewValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({ kind: z.literal('image'), url: z.string().nullable() }),
  z.object({ kind: z.literal('flag'), value: z.boolean() }),
  z.object({
    kind: z.literal('price'),
    amountCents: z.number().int().nonnegative(),
    currency: z.string(),
  }),
  z.object({ kind: z.literal('list'), items: z.array(z.string()) }),
  z.object({
    kind: z.literal('blocks'),
    items: z.array(z.object({ type: z.enum(LESSON_BLOCK_TYPES), detail: z.string() })),
  }),
]);

export const versionPreviewSchema = z.object({
  fields: z.array(
    z.object({ name: versionPreviewFieldNameSchema, value: versionPreviewValueSchema }),
  ),
});

export type VersionPreview = z.infer<typeof versionPreviewSchema>;

type PreviewField = VersionPreview['fields'][number];

const text = (name: VersionPreviewFieldName, value: string): PreviewField => ({
  name,
  value: { kind: 'text', value },
});

const courseSchemaShape = z.object({
  name: z.string(),
  description: z.string(),
  imageUrl: z.string().nullable(),
  moduleOrder: z.array(z.string()),
  publiclyVisible: z.boolean(),
});

const moduleSchemaShape = z.object({
  title: z.string(),
  prefix: z.string().nullable(),
  chapters: z.array(
    z.object({ name: z.string(), contents: z.array(z.object({ name: z.string() })) }),
  ),
});

const lessonSchemaShape = z.object({
  name: z.string(),
  contents: z.array(z.record(z.unknown())),
});

const productSchemaShape = z.object({
  title: z.string(),
  description: z.string(),
  priceCents: z.number(),
  currency: z.string(),
});

const blockDetailSchema = z.object({
  type: z.enum(LESSON_BLOCK_TYPES),
  storageKey: z.string().optional(),
  streamVideoId: z.string().optional(),
  embedUrl: z.string().optional(),
  pdfUrl: z.string().optional(),
  url: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const blockDetail = (block: unknown): { type: (typeof LESSON_BLOCK_TYPES)[number]; detail: string } => {
  const parsed = blockDetailSchema.parse(block);
  if (parsed.type === 'video') return { type: 'video', detail: parsed.streamVideoId ?? parsed.storageKey ?? '' };
  if (parsed.type === 'embed') return { type: 'embed', detail: parsed.embedUrl ?? '' };
  if (parsed.type === 'pdf') return { type: 'pdf', detail: parsed.name ?? parsed.pdfUrl ?? '' };
  if (parsed.type === 'link') return { type: 'link', detail: parsed.description ?? parsed.url ?? '' };
  return { type: 'html', detail: '' };
};

const courseFields = (payload: unknown, moduleNames: ReadonlyMap<string, string>): PreviewField[] => {
  const course = courseSchemaShape.parse(payload);
  return [
    text('title', course.name),
    text('description', course.description),
    { name: 'imageUrl', value: { kind: 'image', url: course.imageUrl } },
    { name: 'publiclyVisible', value: { kind: 'flag', value: course.publiclyVisible } },
    {
      name: 'modules',
      value: {
        kind: 'list',
        items: course.moduleOrder.map((moduleId) => moduleNames.get(moduleId) ?? moduleId),
      },
    },
  ];
};

const moduleFields = (payload: unknown): PreviewField[] => {
  const courseModule = moduleSchemaShape.parse(payload);
  return [
    text('title', courseModule.title),
    text('prefix', courseModule.prefix ?? ''),
    {
      name: 'chapters',
      value: {
        kind: 'list',
        items: courseModule.chapters.flatMap((chapter) =>
          chapter.contents.length === 0
            ? [chapter.name]
            : chapter.contents.map((content) => `${chapter.name} / ${content.name}`),
        ),
      },
    },
  ];
};

const lessonFields = (payload: unknown): PreviewField[] => {
  const lesson = lessonSchemaShape.parse(payload);
  return [
    text('title', lesson.name),
    { name: 'blocks', value: { kind: 'blocks', items: lesson.contents.map(blockDetail) } },
  ];
};

const productFields = (payload: unknown): PreviewField[] => {
  const product = productSchemaShape.parse(payload);
  return [
    text('title', product.title),
    {
      name: 'price',
      value: { kind: 'price', amountCents: product.priceCents, currency: product.currency },
    },
    text('description', product.description),
  ];
};

/**
 * Accepts either a stored snapshot payload already upcast to the current
 * schema or the live entity — the shape guard keeps both identical.
 */
export const buildVersionPreview = (
  kind: EntityKind,
  payload: unknown,
  moduleNames: ReadonlyMap<string, string>,
): Result<VersionPreview, AppError> => {
  const parsed = SNAPSHOT_CURRENT_SCHEMAS[kind].safeParse(payload);
  if (!parsed.success) return err(internal(`Cannot preview ${kind}: payload does not match current schema`));
  if (kind === 'course') return ok({ fields: courseFields(parsed.data, moduleNames) });
  if (kind === 'course_module') return ok({ fields: moduleFields(parsed.data) });
  if (kind === 'course_lesson') return ok({ fields: lessonFields(parsed.data) });
  return ok({ fields: productFields(parsed.data) });
};

export const changedPreviewFields = (
  before: VersionPreview,
  after: VersionPreview,
): VersionPreviewFieldName[] => {
  const afterByName = new Map(after.fields.map((field) => [field.name, field.value]));
  return before.fields
    .filter((field) => {
      const counterpart = afterByName.get(field.name);
      return counterpart === undefined || !snapshotPayloadsEqual(field.value, counterpart);
    })
    .map((field) => field.name);
};
