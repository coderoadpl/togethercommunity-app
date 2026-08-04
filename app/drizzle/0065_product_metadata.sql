ALTER TABLE "products" ADD COLUMN "type" text DEFAULT 'course' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cover_url" text;--> statement-breakpoint
WITH RECURSIVE "source_products" AS (
	SELECT
		ROW_NUMBER() OVER (ORDER BY "tenant_id", "created_at", "id") AS "position",
		"id",
		"tenant_id",
		COALESCE(
			NULLIF(
				TRIM(BOTH '-' FROM LEFT(
					REGEXP_REPLACE(
						REGEXP_REPLACE(
							NORMALIZE(LOWER("title"), NFKD),
							U&'[\0300-\036f]',
							'',
							'g'
						),
						'[^a-z0-9]+',
						'-',
						'g'
					),
					90
				)),
				''
			),
			'product'
		) AS "base_slug"
	FROM "products"
), "allocated_products" AS (
	SELECT
		"position",
		"id",
		"tenant_id",
		"base_slug" AS "generated_slug",
		ARRAY["tenant_id" || E'\\x1f' || "base_slug"] AS "allocated_slugs"
	FROM "source_products"
	WHERE "position" = 1
	UNION ALL
	SELECT
		"source_products"."position",
		"source_products"."id",
		"source_products"."tenant_id",
		"next_slug"."value",
		"allocated_products"."allocated_slugs"
			|| ("source_products"."tenant_id" || E'\\x1f' || "next_slug"."value")
	FROM "allocated_products"
	JOIN "source_products"
		ON "source_products"."position" = "allocated_products"."position" + 1
	CROSS JOIN LATERAL (
		SELECT CASE
			WHEN "suffix" = 1 THEN "source_products"."base_slug"
			ELSE "source_products"."base_slug" || '-' || "suffix"
		END AS "value"
		FROM GENERATE_SERIES(1, "source_products"."position" + 1) AS "suffix"
		WHERE NOT (
			"source_products"."tenant_id" || E'\\x1f' || CASE
				WHEN "suffix" = 1 THEN "source_products"."base_slug"
				ELSE "source_products"."base_slug" || '-' || "suffix"
			END
			= ANY("allocated_products"."allocated_slugs")
		)
		ORDER BY "suffix"
		LIMIT 1
	) AS "next_slug"
)
UPDATE "products"
SET "slug" = "allocated_products"."generated_slug"
FROM "allocated_products"
WHERE "products"."id" = "allocated_products"."id";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_slug_uidx" ON "products" USING btree ("tenant_id","slug");
