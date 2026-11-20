ALTER TABLE "change_proposals" DROP CONSTRAINT "change_proposals_operation_check";
--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_operation_check" CHECK ("operation" IN (
  'product.create', 'product.update', 'product.publish', 'product.unpublish', 'product.delete-draft',
  'price.create', 'price.deactivate', 'stock.enable', 'stock.adjust', 'stock.set-threshold',
  'sales-link.create', 'sales-link.update', 'sales-link.delete', 'settings.update'
));
