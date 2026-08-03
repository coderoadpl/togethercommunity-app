CREATE FUNCTION pg_temp.upcast_lesson_embed_url_v4("input_url" text) RETURNS text AS $$
DECLARE
	"parts" text[];
	"video_id" text;
	"privacy_hash" text;
BEGIN
	IF "input_url" ~* '^https?://((www|m)\.)?youtube\.com([/:?#]|$)'
		OR "input_url" ~* '^https?://(www\.)?youtube-nocookie\.com([/:?#]|$)'
		OR "input_url" ~* '^https?://youtu\.be([/:?#]|$)'
	THEN
		"parts" := regexp_match("input_url", '^https?://youtu\.be/([A-Za-z0-9_-]{11})([?#]|$)', 'i');
		IF "parts" IS NOT NULL THEN
			"video_id" := "parts"[1];
		END IF;
		IF "video_id" IS NULL AND "input_url" ~* '^https?://[^/]+/watch([?#]|$)' THEN
			"parts" := regexp_match("input_url", '[?&]v=([A-Za-z0-9_-]{11})(&|#|$)', 'i');
			IF "parts" IS NOT NULL THEN
				"video_id" := "parts"[1];
			END IF;
		END IF;
		IF "video_id" IS NULL THEN
			"parts" := regexp_match("input_url", '^https?://[^/]+/(embed|shorts|live)/([A-Za-z0-9_-]{11})([?#]|$)', 'i');
			IF "parts" IS NOT NULL AND lower("parts"[2]) <> 'videoseries' THEN
				"video_id" := "parts"[2];
			END IF;
		END IF;
		IF "video_id" IS NOT NULL THEN
			RETURN 'https://www.youtube-nocookie.com/embed/' || "video_id";
		END IF;
		RETURN 'https://legacy-embed.invalid/?url_hex=' || encode(convert_to("input_url", 'UTF8'), 'hex');
	END IF;

	IF "input_url" ~* '^https?://(www\.)?vimeo\.com([/:?#]|$)'
		OR "input_url" ~* '^https?://player\.vimeo\.com([/:?#]|$)'
	THEN
		"parts" := regexp_match("input_url", '[?&]h=([A-Fa-f0-9]{6,16})(&|#|$)', 'i');
		IF "parts" IS NOT NULL THEN
			"privacy_hash" := "parts"[1];
		ELSIF "input_url" ~* '[?&]h=' THEN
			RETURN 'https://legacy-embed.invalid/?url_hex=' || encode(convert_to("input_url", 'UTF8'), 'hex');
		END IF;

		"parts" := regexp_match("input_url", '/channels/[^/?#]+/([0-9]+)([?#]|$)', 'i');
		IF "parts" IS NULL THEN
			"parts" := regexp_match("input_url", '/groups/[^/?#]+/videos/([0-9]+)([?#]|$)', 'i');
		END IF;
		IF "parts" IS NULL THEN
			"parts" := regexp_match("input_url", '^https?://player\.vimeo\.com/video/([0-9]+)([?#]|$)', 'i');
		END IF;
		IF "parts" IS NULL THEN
			"parts" := regexp_match("input_url", '^https?://(www\.)?vimeo\.com/([0-9]+)(/([A-Fa-f0-9]{6,16}))?([?#]|$)', 'i');
			IF "parts" IS NOT NULL THEN
				"video_id" := "parts"[2];
				IF "privacy_hash" IS NULL THEN
					"privacy_hash" := "parts"[4];
				END IF;
			END IF;
		ELSIF "parts" IS NOT NULL THEN
			"video_id" := "parts"[1];
		END IF;

		IF "video_id" IS NOT NULL THEN
			RETURN 'https://player.vimeo.com/video/' || "video_id"
				|| CASE WHEN "privacy_hash" IS NULL THEN '' ELSE '?h=' || "privacy_hash" END;
		END IF;
		RETURN 'https://legacy-embed.invalid/?url_hex=' || encode(convert_to("input_url", 'UTF8'), 'hex');
	END IF;

	IF "input_url" ~* '^https?://' THEN
		RETURN "input_url";
	END IF;
	RETURN 'https://legacy-embed.invalid/?url_hex=' || encode(convert_to("input_url", 'UTF8'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
UPDATE "course_lessons"
SET "contents" = COALESCE((
	SELECT jsonb_agg(
		CASE
			WHEN "block"->>'type' = 'embed' AND jsonb_typeof("block"->'embedUrl') = 'string'
				THEN jsonb_set("block", '{embedUrl}', to_jsonb(pg_temp.upcast_lesson_embed_url_v4("block"->>'embedUrl')))
			ELSE "block"
		END
		ORDER BY "position"
	)
	FROM jsonb_array_elements("contents") WITH ORDINALITY AS "lesson_blocks"("block", "position")
), '[]'::jsonb)
WHERE jsonb_typeof("contents") = 'array'
	AND EXISTS (
		SELECT 1
		FROM jsonb_array_elements("contents") AS "lesson_block"("block")
		WHERE "block"->>'type' = 'embed'
	);--> statement-breakpoint
DROP FUNCTION pg_temp.upcast_lesson_embed_url_v4(text);
