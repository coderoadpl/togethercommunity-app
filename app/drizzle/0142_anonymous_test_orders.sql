ALTER TABLE orders ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_member_required_for_live CHECK (member_id IS NOT NULL OR mode = 'test');
