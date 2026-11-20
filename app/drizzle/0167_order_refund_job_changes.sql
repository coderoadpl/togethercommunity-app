CREATE FUNCTION record_refund_job_order_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO order_changes (tenant_id, order_id) VALUES (NEW.tenant_id, NEW.order_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_refund_jobs_record_insert AFTER INSERT ON order_refund_jobs FOR EACH ROW EXECUTE FUNCTION record_refund_job_order_change();
--> statement-breakpoint
CREATE TRIGGER order_refund_jobs_record_status AFTER UPDATE OF status ON order_refund_jobs FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION record_refund_job_order_change();
