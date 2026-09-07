ALTER TABLE "tenants" ADD COLUMN "video_autoplay_default" boolean DEFAULT false NOT NULL;
ALTER TABLE "tenants" ADD COLUMN "member_video_autoplay_override" boolean DEFAULT false NOT NULL;
ALTER TABLE "members" ALTER COLUMN "video_autoplay" DROP DEFAULT;
ALTER TABLE "members" ALTER COLUMN "video_autoplay" DROP NOT NULL;
UPDATE "members" SET "video_autoplay" = NULL WHERE "video_autoplay" = false;
