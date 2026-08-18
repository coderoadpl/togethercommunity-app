ALTER TABLE "member_events" DROP CONSTRAINT IF EXISTS "member_events_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT IF EXISTS "coupon_redemptions_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "member_subscriptions" DROP CONSTRAINT IF EXISTS "member_subscriptions_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "product_grants" DROP CONSTRAINT IF EXISTS "product_grants_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "member_erasure_requests" DROP CONSTRAINT IF EXISTS "member_erasure_requests_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "member_course_progress" DROP CONSTRAINT IF EXISTS "member_course_progress_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "campaign_sends" DROP CONSTRAINT IF EXISTS "campaign_sends_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" DROP CONSTRAINT IF EXISTS "unsubscribe_tokens_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'members_tenant_id_id_pk'
			AND conrelid = 'public.members'::regclass
	) THEN
		ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_events_tenant_member_fk'
			AND conrelid = 'public.member_events'::regclass
	) THEN
		ALTER TABLE "member_events" ADD CONSTRAINT "member_events_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'orders_tenant_member_fk'
			AND conrelid = 'public.orders'::regclass
	) THEN
		ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'coupon_redemptions_tenant_member_fk'
			AND conrelid = 'public.coupon_redemptions'::regclass
	) THEN
		ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_subscriptions_tenant_member_fk'
			AND conrelid = 'public.member_subscriptions'::regclass
	) THEN
		ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_grants_tenant_member_fk'
			AND conrelid = 'public.product_grants'::regclass
	) THEN
		ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_erasure_requests_tenant_member_fk'
			AND conrelid = 'public.member_erasure_requests'::regclass
	) THEN
		ALTER TABLE "member_erasure_requests" ADD CONSTRAINT "member_erasure_requests_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_course_progress_tenant_member_fk'
			AND conrelid = 'public.member_course_progress'::regclass
	) THEN
		ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'campaign_sends_tenant_member_fk'
			AND conrelid = 'public.campaign_sends'::regclass
	) THEN
		ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE SET NULL ("member_id") ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'unsubscribe_tokens_tenant_member_fk'
			AND conrelid = 'public.unsubscribe_tokens'::regclass
	) THEN
		ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_tenant_member_fk" FOREIGN KEY ("tenant_id", "member_id") REFERENCES "public"."members"("tenant_id", "id") ON DELETE SET NULL ("member_id") ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_events_tenant_member_fk'
			AND conrelid = 'public.member_events'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_events" VALIDATE CONSTRAINT "member_events_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'orders_tenant_member_fk'
			AND conrelid = 'public.orders'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'coupon_redemptions_tenant_member_fk'
			AND conrelid = 'public.coupon_redemptions'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "coupon_redemptions" VALIDATE CONSTRAINT "coupon_redemptions_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_subscriptions_tenant_member_fk'
			AND conrelid = 'public.member_subscriptions'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_subscriptions" VALIDATE CONSTRAINT "member_subscriptions_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_grants_tenant_member_fk'
			AND conrelid = 'public.product_grants'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "product_grants" VALIDATE CONSTRAINT "product_grants_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_erasure_requests_tenant_member_fk'
			AND conrelid = 'public.member_erasure_requests'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_erasure_requests" VALIDATE CONSTRAINT "member_erasure_requests_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_course_progress_tenant_member_fk'
			AND conrelid = 'public.member_course_progress'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_course_progress" VALIDATE CONSTRAINT "member_course_progress_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'campaign_sends_tenant_member_fk'
			AND conrelid = 'public.campaign_sends'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "campaign_sends" VALIDATE CONSTRAINT "campaign_sends_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'unsubscribe_tokens_tenant_member_fk'
			AND conrelid = 'public.unsubscribe_tokens'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "unsubscribe_tokens" VALIDATE CONSTRAINT "unsubscribe_tokens_tenant_member_fk";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "product_prices" DROP CONSTRAINT IF EXISTS "product_prices_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_download_assets" DROP CONSTRAINT IF EXISTS "product_download_assets_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "coupon_checkout_sessions" DROP CONSTRAINT IF EXISTS "coupon_checkout_sessions_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_price_history" DROP CONSTRAINT IF EXISTS "product_price_history_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "member_subscriptions" DROP CONSTRAINT IF EXISTS "member_subscriptions_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_grants" DROP CONSTRAINT IF EXISTS "product_grants_product_id_products_id_fk";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'products_tenant_id_id_pk'
			AND conrelid = 'public.products'::regclass
	) THEN
		ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_prices_tenant_product_fk'
			AND conrelid = 'public.product_prices'::regclass
	) THEN
		ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_download_assets_tenant_product_fk'
			AND conrelid = 'public.product_download_assets'::regclass
	) THEN
		ALTER TABLE "product_download_assets" ADD CONSTRAINT "product_download_assets_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'orders_tenant_product_fk'
			AND conrelid = 'public.orders'::regclass
	) THEN
		ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'coupon_checkout_sessions_tenant_product_fk'
			AND conrelid = 'public.coupon_checkout_sessions'::regclass
	) THEN
		ALTER TABLE "coupon_checkout_sessions" ADD CONSTRAINT "coupon_checkout_sessions_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_price_history_tenant_product_fk'
			AND conrelid = 'public.product_price_history'::regclass
	) THEN
		ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_subscriptions_tenant_product_fk'
			AND conrelid = 'public.member_subscriptions'::regclass
	) THEN
		ALTER TABLE "member_subscriptions" ADD CONSTRAINT "member_subscriptions_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_grants_tenant_product_fk'
			AND conrelid = 'public.product_grants'::regclass
	) THEN
		ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_tenant_product_fk" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "public"."products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_prices_tenant_product_fk'
			AND conrelid = 'public.product_prices'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "product_prices" VALIDATE CONSTRAINT "product_prices_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_download_assets_tenant_product_fk'
			AND conrelid = 'public.product_download_assets'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "product_download_assets" VALIDATE CONSTRAINT "product_download_assets_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'orders_tenant_product_fk'
			AND conrelid = 'public.orders'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'coupon_checkout_sessions_tenant_product_fk'
			AND conrelid = 'public.coupon_checkout_sessions'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "coupon_checkout_sessions" VALIDATE CONSTRAINT "coupon_checkout_sessions_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_price_history_tenant_product_fk'
			AND conrelid = 'public.product_price_history'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "product_price_history" VALIDATE CONSTRAINT "product_price_history_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_subscriptions_tenant_product_fk'
			AND conrelid = 'public.member_subscriptions'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_subscriptions" VALIDATE CONSTRAINT "member_subscriptions_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_grants_tenant_product_fk'
			AND conrelid = 'public.product_grants'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "product_grants" VALIDATE CONSTRAINT "product_grants_tenant_product_fk";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "member_course_progress" DROP CONSTRAINT IF EXISTS "member_course_progress_course_id_courses_id_fk";--> statement-breakpoint
ALTER TABLE "courses" DROP CONSTRAINT IF EXISTS "courses_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'courses_tenant_id_id_pk'
			AND conrelid = 'public.courses'::regclass
	) THEN
		ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_course_progress_tenant_course_fk'
			AND conrelid = 'public.member_course_progress'::regclass
	) THEN
		ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_tenant_course_fk" FOREIGN KEY ("tenant_id", "course_id") REFERENCES "public"."courses"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_course_progress_tenant_course_fk'
			AND conrelid = 'public.member_course_progress'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "member_course_progress" VALIDATE CONSTRAINT "member_course_progress_tenant_course_fk";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lesson_attachments" DROP CONSTRAINT IF EXISTS "lesson_attachments_lesson_id_course_lessons_id_fk";--> statement-breakpoint
ALTER TABLE "course_lessons" DROP CONSTRAINT IF EXISTS "course_lessons_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'course_lessons_tenant_id_id_pk'
			AND conrelid = 'public.course_lessons'::regclass
	) THEN
		ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'lesson_attachments_tenant_lesson_fk'
			AND conrelid = 'public.lesson_attachments'::regclass
	) THEN
		ALTER TABLE "lesson_attachments" ADD CONSTRAINT "lesson_attachments_tenant_lesson_fk" FOREIGN KEY ("tenant_id", "lesson_id") REFERENCES "public"."course_lessons"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'lesson_attachments_tenant_lesson_fk'
			AND conrelid = 'public.lesson_attachments'::regclass
			AND NOT convalidated
	) THEN
		ALTER TABLE "lesson_attachments" VALIDATE CONSTRAINT "lesson_attachments_tenant_lesson_fk";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "course_modules" DROP CONSTRAINT IF EXISTS "course_modules_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'course_modules_tenant_id_id_pk'
			AND conrelid = 'public.course_modules'::regclass
	) THEN
		ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "product_grants" DROP CONSTRAINT IF EXISTS "product_grants_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'product_grants_tenant_id_id_pk'
			AND conrelid = 'public.product_grants'::regclass
	) THEN
		ALTER TABLE "product_grants" ADD CONSTRAINT "product_grants_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "member_course_progress" DROP CONSTRAINT IF EXISTS "member_course_progress_pkey";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT FROM pg_constraint
		WHERE conname = 'member_course_progress_tenant_id_id_pk'
			AND conrelid = 'public.member_course_progress'::regclass
	) THEN
		ALTER TABLE "member_course_progress" ADD CONSTRAINT "member_course_progress_tenant_id_id_pk" PRIMARY KEY ("tenant_id", "id");
	END IF;
END $$;