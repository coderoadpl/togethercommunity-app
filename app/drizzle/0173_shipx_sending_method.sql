ALTER TABLE "tenants" ADD COLUMN "shipx_sending_method" text DEFAULT 'parcel_locker' NOT NULL
  CONSTRAINT "tenants_shipx_sending_method_check" CHECK ("shipx_sending_method" IN ('parcel_locker', 'dispatch_order', 'pop'));
