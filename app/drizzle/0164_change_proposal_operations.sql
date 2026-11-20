ALTER TABLE "change_proposals" DROP CONSTRAINT "change_proposals_operation_check";
--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_operation_check" CHECK (
  char_length("operation") <= 64 AND "operation" ~ '^[a-z]+(-[a-z]+)*[.][a-z]+(-[a-z]+)*$'
) NOT VALID;
--> statement-breakpoint
ALTER TABLE "change_proposals" VALIDATE CONSTRAINT "change_proposals_operation_check";
