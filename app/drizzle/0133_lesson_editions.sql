ALTER TABLE entity_versions ADD COLUMN edition_number text;
--> statement-breakpoint
ALTER TABLE entity_versions ADD COLUMN edition_note text;
--> statement-breakpoint
ALTER TABLE entity_versions ADD COLUMN edition_marked_at text;
--> statement-breakpoint
CREATE UNIQUE INDEX entity_versions_lesson_edition_uidx
  ON entity_versions (tenant_id, entity_id, edition_number)
  WHERE entity_kind = 'course_lesson' AND edition_number IS NOT NULL;
