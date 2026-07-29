UPDATE "products"
SET "access_items" = COALESCE((
	SELECT jsonb_agg("mapped_item")
	FROM (
		SELECT (
			CASE
				WHEN "elem" ? 'level' THEN "elem"
				WHEN COALESCE(("elem"->>'courseLevelAccess')::boolean, false) THEN
					jsonb_build_object('level', 'course', 'courseId', "elem"->'courseId')
				WHEN jsonb_array_length(COALESCE("elem"->'moduleIds', '[]'::jsonb)) > 0 THEN
					jsonb_build_object('level', 'modules', 'courseId', "elem"->'courseId', 'moduleIds', "elem"->'moduleIds')
				WHEN jsonb_array_length(COALESCE("elem"->'lessonIds', '[]'::jsonb)) > 0 THEN
					jsonb_build_object('level', 'lessons', 'courseId', "elem"->'courseId', 'lessonIds', "elem"->'lessonIds')
				ELSE NULL
			END
		) AS "mapped_item"
		FROM jsonb_array_elements("access_items") AS "elem"
	) AS "mapped"
	WHERE "mapped_item" IS NOT NULL
), '[]'::jsonb)
WHERE jsonb_typeof("access_items") = 'array' AND jsonb_array_length("access_items") > 0;
