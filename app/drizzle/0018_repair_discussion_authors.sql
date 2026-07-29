UPDATE "posts" AS p
SET "author_display" = COALESCE(
	NULLIF(
		btrim(
			initcap(
				regexp_replace(
					split_part(split_part(COALESCE(u."email", ''), '@', 1), '+', 1),
					'[._-]+',
					' ',
					'g'
				)
			)
		),
		''
	),
	'Uczestnik'
)
FROM "user" AS u
WHERE p."author_user_id" = u."id"
	AND btrim(p."author_display") = '';--> statement-breakpoint
UPDATE "posts"
SET "author_display" = 'Uczestnik'
WHERE btrim("author_display") = '';
