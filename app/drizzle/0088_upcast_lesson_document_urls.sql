CREATE FUNCTION pg_temp.encode_uri_component_v6("input" text) RETURNS text AS $$
DECLARE
	"unreserved" constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*''()';
	"raw" bytea := convert_to("input", 'UTF8');
	"index" int;
	"byte" int;
	"encoded" text := '';
BEGIN
	FOR "index" IN 0..length("raw") - 1 LOOP
		"byte" := get_byte("raw", "index");
		IF "byte" < 128 AND strpos("unreserved", chr("byte")) > 0 THEN
			"encoded" := "encoded" || chr("byte");
		ELSE
			"encoded" := "encoded" || '%' || upper(lpad(to_hex("byte"), 2, '0'));
		END IF;
	END LOOP;
	RETURN "encoded";
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
/* POSIX `\s` follows the database ctype and matches neither U+00A0 nor U+FEFF,
 * so the JavaScript `\s` set the lesson schema trims and rejects on is spelled out. */
CREATE FUNCTION pg_temp.js_whitespace_v6() RETURNS text AS $$
	SELECT '\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
CREATE FUNCTION pg_temp.trim_js_whitespace_v6("input" text) RETURNS text AS $$
DECLARE
	"class" constant text := pg_temp.js_whitespace_v6();
BEGIN
	RETURN regexp_replace("input", '^[' || "class" || ']+|[' || "class" || ']+$', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
/* Deliberately narrower than WHATWG URL parsing: a regex cannot decide what
 * `new URL` accepts, so an authority that is not certainly parseable is parked. */
CREATE FUNCTION pg_temp.is_parseable_http_url_v6("input" text) RETURNS boolean AS $$
DECLARE
	"authority" text := (regexp_match("input", '^https?://([^/?#]*)', 'i'))[1];
	"port" text;
BEGIN
	IF "authority" IS NULL OR "authority" !~ '^[A-Za-z0-9._~-]+(:[0-9]{1,5})?$' THEN
		RETURN false;
	END IF;
	"port" := split_part("authority", ':', 2);
	RETURN "port" = '' OR "port"::int <= 65535;
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
CREATE FUNCTION pg_temp.upcast_lesson_document_url_v6("input" text) RETURNS text AS $$
DECLARE
	"trimmed" text := pg_temp.trim_js_whitespace_v6("input");
BEGIN
	IF pg_temp.is_parseable_http_url_v6("trimmed")
		OR "trimmed" ~ ('^/(?![/\\])[^\\' || pg_temp.js_whitespace_v6() || ']+$')
	THEN
		RETURN "trimmed";
	END IF;
	RETURN 'https://legacy-document.invalid/?url=' || pg_temp.encode_uri_component_v6("input");
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
CREATE FUNCTION pg_temp.upcast_lesson_link_url_v6("input" text) RETURNS text AS $$
DECLARE
	"trimmed" text := pg_temp.trim_js_whitespace_v6("input");
BEGIN
	IF pg_temp.is_parseable_http_url_v6("trimmed") OR "trimmed" ~* '^mailto:' THEN
		RETURN "trimmed";
	END IF;
	RETURN 'https://legacy-link.invalid/?url=' || pg_temp.encode_uri_component_v6("input");
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
UPDATE "course_lessons"
SET "contents" = COALESCE((
	SELECT jsonb_agg(
		CASE
			WHEN "block"->>'type' = 'pdf' AND jsonb_typeof("block"->'pdfUrl') = 'string'
				THEN jsonb_set("block", '{pdfUrl}', to_jsonb(pg_temp.upcast_lesson_document_url_v6("block"->>'pdfUrl')))
			WHEN "block"->>'type' = 'link' AND jsonb_typeof("block"->'url') = 'string'
				THEN jsonb_set("block", '{url}', to_jsonb(pg_temp.upcast_lesson_link_url_v6("block"->>'url')))
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
		WHERE ("block"->>'type' = 'pdf'
				AND jsonb_typeof("block"->'pdfUrl') = 'string'
				AND pg_temp.upcast_lesson_document_url_v6("block"->>'pdfUrl') <> "block"->>'pdfUrl')
			OR ("block"->>'type' = 'link'
				AND jsonb_typeof("block"->'url') = 'string'
				AND pg_temp.upcast_lesson_link_url_v6("block"->>'url') <> "block"->>'url')
	);--> statement-breakpoint
DROP FUNCTION pg_temp.upcast_lesson_document_url_v6(text);--> statement-breakpoint
DROP FUNCTION pg_temp.upcast_lesson_link_url_v6(text);--> statement-breakpoint
DROP FUNCTION pg_temp.is_parseable_http_url_v6(text);--> statement-breakpoint
DROP FUNCTION pg_temp.trim_js_whitespace_v6(text);--> statement-breakpoint
DROP FUNCTION pg_temp.js_whitespace_v6();--> statement-breakpoint
DROP FUNCTION pg_temp.encode_uri_component_v6(text);
