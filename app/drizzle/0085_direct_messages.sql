CREATE TABLE "dm_conversation_states" (
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dm_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"participant_low_user_id" text NOT NULL,
	"participant_high_user_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" text NOT NULL,
	"last_message_id" text,
	"last_message_at" text NOT NULL,
	"last_message_snippet" text NOT NULL,
	"last_message_sender_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dm_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "dm_opt_out_at" text;--> statement-breakpoint
ALTER TABLE "dm_conversation_states" ADD CONSTRAINT "dm_conversation_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversation_states" ADD CONSTRAINT "dm_conversation_states_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_conversation_states_tenant_conversation_user_uidx" ON "dm_conversation_states" USING btree ("tenant_id","conversation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dm_conversations_tenant_pair_uidx" ON "dm_conversations" USING btree ("tenant_id","participant_low_user_id","participant_high_user_id");--> statement-breakpoint
CREATE INDEX "dm_conversations_tenant_last_message_idx" ON "dm_conversations" USING btree ("tenant_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dm_conversations_tenant_participant_low_idx" ON "dm_conversations" USING btree ("tenant_id","participant_low_user_id");--> statement-breakpoint
CREATE INDEX "dm_conversations_tenant_participant_high_idx" ON "dm_conversations" USING btree ("tenant_id","participant_high_user_id");--> statement-breakpoint
CREATE INDEX "dm_conversations_tenant_creator_created_idx" ON "dm_conversations" USING btree ("tenant_id","created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "dm_messages_tenant_conversation_created_idx" ON "dm_messages" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "dm_messages_tenant_sender_created_idx" ON "dm_messages" USING btree ("tenant_id","sender_user_id","created_at");