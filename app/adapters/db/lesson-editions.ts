import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { compareLessonEditionNumbers, lessonEditionSchema } from '#core/domain/index.js';
import type { LessonEditionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { uniqueViolation } from './pg-errors.js';
import { entityVersions } from './schema.js';

export const createLessonEditionRepository = (db: Db): LessonEditionRepository => ({
  list: async (tenantId, lessonId) => {
    const rows = await db.select().from(entityVersions).where(and(
      eq(entityVersions.tenantId, tenantId), eq(entityVersions.entityKind, 'course_lesson'),
      eq(entityVersions.entityId, lessonId), isNotNull(entityVersions.editionNumber),
    ));
    return rows.map((row) => lessonEditionSchema.parse({
      versionId: row.id, number: row.editionNumber, note: row.editionNote, markedAt: row.editionMarkedAt,
    })).sort((left, right) => compareLessonEditionNumbers(right.number, left.number));
  },
  find: async (tenantId, lessonId, number) => {
    const [row] = await db.select().from(entityVersions).where(and(
      eq(entityVersions.tenantId, tenantId), eq(entityVersions.entityKind, 'course_lesson'),
      eq(entityVersions.entityId, lessonId), eq(entityVersions.editionNumber, number),
    )).limit(1);
    return row ?? null;
  },
  mark: async (tenantId, version, edition, markedAt) => {
    try {
      const [row] = await db.insert(entityVersions).values({
        ...version, tenantId, editionNumber: edition.number, editionNote: edition.note ?? null, editionMarkedAt: markedAt,
      }).onConflictDoUpdate({
        target: entityVersions.id,
        set: { editionNumber: edition.number, editionNote: edition.note ?? null, editionMarkedAt: markedAt },
        setWhere: sql`${entityVersions.tenantId} = ${tenantId} and ${entityVersions.entityKind} = 'course_lesson' and ${entityVersions.entityId} = ${version.entityId}`,
      }).returning();
      if (row === undefined) return 'conflict';
      return lessonEditionSchema.parse({ versionId: row.id, number: row.editionNumber, note: row.editionNote, markedAt: row.editionMarkedAt });
    } catch (cause) {
      if (uniqueViolation(cause, 'entity_versions_lesson_edition_uidx')) return 'conflict';
      throw cause;
    }
  },
  unmark: async (tenantId, lessonId, number) => {
    const rows = await db.update(entityVersions).set({ editionNumber: null, editionNote: null, editionMarkedAt: null }).where(and(
      eq(entityVersions.tenantId, tenantId), eq(entityVersions.entityKind, 'course_lesson'),
      eq(entityVersions.entityId, lessonId), eq(entityVersions.editionNumber, number),
    )).returning({ id: entityVersions.id });
    return rows.length === 1;
  },
});
