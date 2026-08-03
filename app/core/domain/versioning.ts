import { z } from 'zod';

import { courseLessonSchema, courseModuleSchema, courseSchema } from './course.js';
import { internal, validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { productSchema } from './product.js';
import { courseSnapshotV2Schema } from './snapshots/course/v2.js';
import { courseLessonSnapshotV3Schema } from './snapshots/course_lesson/v3.js';
import { courseLessonSnapshotV4Schema, upcastLegacyVideoEmbedUrlV4 } from './snapshots/course_lesson/v4.js';
import { courseModuleSnapshotV1Schema } from './snapshots/course_module/v1.js';
import { productSnapshotV2Schema } from './snapshots/product/v2.js';

/**
 * Content versioning: every mutable content entity is snapshotted under a
 * `schemaVersion`, and an ENFORCED upcaster chain guarantees any historical
 * payload can be read back as the current shape. Backward compatibility is
 * machine-checked (see `versioning.test.ts`), not left to discipline.
 */

export const ENTITY_KINDS = ['course', 'course_module', 'course_lesson', 'product'] as const;

export const entityKindSchema = z.enum(ENTITY_KINDS);

export type EntityKind = z.infer<typeof entityKindSchema>;

/** Frozen schema for the CURRENT version of each kind (bump adds a new file). */
const currentSchemas: Record<EntityKind, z.ZodTypeAny> = {
  course: courseSnapshotV2Schema,
  course_module: courseModuleSnapshotV1Schema,
  course_lesson: courseLessonSnapshotV4Schema,
  product: productSnapshotV2Schema,
};

/** Live entity schemas the write-through path snapshots and the guard tracks. */
const liveEntitySchemas: Record<EntityKind, z.ZodTypeAny> = {
  course: courseSchema,
  course_module: courseModuleSchema,
  course_lesson: courseLessonSchema,
  product: productSchema,
};

export const CURRENT_SNAPSHOT_SCHEMA_VERSION: Record<EntityKind, number> = {
  course: 2,
  course_module: 1,
  course_lesson: 4,
  product: 2,
};

type Upcaster = (payload: unknown) => unknown;

const upcastCourseLessonV3 = (payload: unknown): unknown => {
  const lesson = courseLessonSnapshotV3Schema.parse(payload);
  return {
    ...lesson,
    contents: lesson.contents.map((block) =>
      block.type === 'embed' ? { ...block, embedUrl: upcastLegacyVideoEmbedUrlV4(block.embedUrl) } : block,
    ),
  };
};

/**
 * Pure `v(n) -> v(n+1)` transforms per kind. Empty while every kind is at v1;
 * a version bump MUST register the `v(n)` entry here or the chain fails loudly.
 */
const upcasters: Record<EntityKind, Record<number, Upcaster>> = {
  // v1 payloads predate the explicit module ordering; default it to empty so the
  // module set falls back to creation order until staff reorder it.
  course: { 1: (payload) => ({ ...z.object({}).passthrough().parse(payload), moduleOrder: [] }) },
  course_module: {},
  // v1 payloads (pdfUrl restricted to absolute URLs) are a strict subset of v2,
  // and v2 of v3 (durationMinutes is optional). v3 embed URLs are normalized or
  // moved to a safe generic URL before v4 applies provider validation.
  course_lesson: { 1: (payload) => payload, 2: (payload) => payload, 3: upcastCourseLessonV3 },
  product: {
    1: (payload) => ({
      ...z.object({}).passthrough().parse(payload),
      checkoutConsentDefinitionIds: [],
    }),
  },
};

export interface VersionedSnapshot {
  schemaVersion: number;
  payload: unknown;
}

/** Applies the registered chain from `fromVersion` up to the current version. */
export const runUpcastChain = (
  kind: EntityKind,
  fromVersion: number,
  payload: unknown,
): Result<unknown, AppError> => {
  const target = CURRENT_SNAPSHOT_SCHEMA_VERSION[kind];
  if (fromVersion > target) {
    return err(validation(`Snapshot ${kind} v${fromVersion} is newer than current v${target}`));
  }
  let current = payload;
  let version = fromVersion;
  while (version < target) {
    const step = upcasters[kind][version];
    if (!step) return err(internal(`Missing upcaster for ${kind} v${version} -> v${version + 1}`));
    current = step(current);
    version += 1;
  }
  return ok(current);
};

/** Runs the chain to current and parses with the current frozen schema. */
export const readSnapshot = (
  kind: EntityKind,
  input: VersionedSnapshot,
): Result<VersionedSnapshot, AppError> => {
  const chained = runUpcastChain(kind, input.schemaVersion, input.payload);
  if (!chained.ok) return chained;
  const parsed = currentSchemas[kind].safeParse(chained.value);
  if (!parsed.success) {
    return err(validation(`Snapshot payload does not match current ${kind} schema`, parsed.error.flatten()));
  }
  return ok({ schemaVersion: CURRENT_SNAPSHOT_SCHEMA_VERSION[kind], payload: parsed.data });
};

/** Builds the versioned envelope written to `entity_versions` for a snapshot. */
export const buildSnapshot = (kind: EntityKind, entity: unknown): Result<VersionedSnapshot, AppError> => {
  const parsed = currentSchemas[kind].safeParse(entity);
  if (!parsed.success) {
    return err(internal(`Cannot snapshot ${kind}: entity does not match current schema`));
  }
  return ok({ schemaVersion: CURRENT_SNAPSHOT_SCHEMA_VERSION[kind], payload: parsed.data });
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(z.record(z.unknown()).parse(value))
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};

/**
 * Key-order-insensitive payload equality, used to skip writing a snapshot
 * identical to the latest stored one (a save that changed nothing).
 */
export const snapshotPayloadsEqual = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

// --- shape guard -----------------------------------------------------------

const stringCheckSignature = (check: z.ZodStringCheck): string => {
  if (check.kind === 'min' || check.kind === 'max' || check.kind === 'length') {
    return `${check.kind}:${check.value}`;
  }
  if (check.kind === 'regex') return `regex:${check.regex.source}`;
  return check.kind;
};

const numberCheckSignature = (check: z.ZodNumberCheck): string => {
  if (check.kind === 'min' || check.kind === 'max') return `${check.kind}:${check.value}:${check.inclusive}`;
  if (check.kind === 'multipleOf') return `multipleOf:${check.value}`;
  return check.kind;
};

/**
 * Canonical, message-free structural signature of a zod schema. Two schemas
 * with identical shape (a live entity and its frozen copy) hash equal; any
 * added/removed/renamed field or changed type/check flips the hash.
 */
const describeSchema = (schema: z.ZodTypeAny): string => {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    const entries = Object.keys(shape)
      .sort()
      .map((key) => `${key}:${describeSchema(shape[key] ?? z.never())}`);
    return `object({${entries.join(',')}})`;
  }
  if (schema instanceof z.ZodString) {
    return `string[${schema._def.checks.map(stringCheckSignature).sort().join(',')}]`;
  }
  if (schema instanceof z.ZodNumber) {
    return `number[${schema._def.checks.map(numberCheckSignature).sort().join(',')}]`;
  }
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodArray) return `array(${describeSchema(schema.element)})`;
  if (schema instanceof z.ZodOptional) return `optional(${describeSchema(schema.unwrap())})`;
  if (schema instanceof z.ZodNullable) return `nullable(${describeSchema(schema.unwrap())})`;
  if (schema instanceof z.ZodDefault) return `default(${describeSchema(schema._def.innerType)})`;
  if (schema instanceof z.ZodEnum) {
    const values: readonly string[] = schema.options;
    return `enum(${[...values].sort().join('|')})`;
  }
  if (schema instanceof z.ZodLiteral) return `literal(${String(schema.value)})`;
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options: z.ZodTypeAny[] = schema.options;
    return `disc(${schema._def.discriminator};${options.map(describeSchema).sort().join('|')})`;
  }
  if (schema instanceof z.ZodUnion) {
    const options: z.ZodTypeAny[] = schema._def.options;
    return `union(${options.map(describeSchema).sort().join('|')})`;
  }
  if (schema instanceof z.ZodEffects) return `effects(${describeSchema(schema.innerType())})`;
  throw new Error('Unsupported zod node in shape signature');
};

const fnv1aHex = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const entityShapeHash = (schema: z.ZodTypeAny): string => fnv1aHex(describeSchema(schema));

export const SNAPSHOT_LIVE_ENTITY_SCHEMAS: Record<EntityKind, z.ZodTypeAny> = liveEntitySchemas;

export const SNAPSHOT_CURRENT_SCHEMAS: Record<EntityKind, z.ZodTypeAny> = currentSchemas;

/**
 * The tripwire. If a live entity schema's shape changes, its hash no longer
 * matches the value stored here and the enforcement test fails with the steps
 * in `shapeGuardInstructions`. Updating this map is the LAST step of a bump.
 */
export const STORED_ENTITY_SHAPE_HASH: Record<EntityKind, string> = {
  course: '94a7899a',
  course_module: 'db069353',
  course_lesson: 'b5ae5453',
  product: '94350883',
};

// --- read-surface DTOs -----------------------------------------------------

export const entityHistoryQuerySchema = z.object({
  entityKind: entityKindSchema,
  entityId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type EntityHistoryQuery = z.infer<typeof entityHistoryQuerySchema>;
export type EntityHistoryQueryInput = z.input<typeof entityHistoryQuerySchema>;

export const courseHistoryQuerySchema = z.object({
  courseId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CourseHistoryQuery = z.infer<typeof courseHistoryQuerySchema>;
export type CourseHistoryQueryInput = z.input<typeof courseHistoryQuerySchema>;

export const entityHistoryEntrySchema = z.object({
  id: z.string(),
  entityKind: entityKindSchema,
  entityId: z.string(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  createdBy: z.string().nullable(),
});

export type EntityHistoryEntry = z.infer<typeof entityHistoryEntrySchema>;

export const courseHistoryEntrySchema = entityHistoryEntrySchema.extend({
  subjectKind: z.enum(['course', 'module']),
  subjectName: z.string().min(1),
  createdByDisplayName: z.string().min(1).nullable(),
});

export type CourseHistoryEntry = z.infer<typeof courseHistoryEntrySchema>;

export const entityVersionDetailSchema = entityHistoryEntrySchema.extend({
  currentSchemaVersion: z.number().int().positive(),
  payload: z.unknown(),
});

export type EntityVersionDetail = z.infer<typeof entityVersionDetailSchema>;

export const shapeGuardInstructions = (kind: EntityKind): string =>
  [
    `The '${kind}' entity zod shape changed but content versioning was not bumped.`,
    `To restore backward-compatibility enforcement:`,
    `  1. Copy the previous frozen schema to core/domain/snapshots/${kind}/v${CURRENT_SNAPSHOT_SCHEMA_VERSION[kind]}.ts (keep it EXACTLY as it was).`,
    `  2. Add a new frozen schema core/domain/snapshots/${kind}/v${CURRENT_SNAPSHOT_SCHEMA_VERSION[kind] + 1}.ts matching the new shape and point currentSchemas at it.`,
    `  3. Bump CURRENT_SNAPSHOT_SCHEMA_VERSION['${kind}'] and register an upcaster v${CURRENT_SNAPSHOT_SCHEMA_VERSION[kind]} -> v${CURRENT_SNAPSHOT_SCHEMA_VERSION[kind] + 1}.`,
    `  4. Add a fixture for the new version in core/domain/snapshots/fixtures.ts.`,
    `  5. Update STORED_ENTITY_SHAPE_HASH['${kind}'] to the new hash printed by this test.`,
  ].join('\n');
