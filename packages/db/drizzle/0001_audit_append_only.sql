-- Custom migration (plan §15): audit_logs is append-only.
-- UPDATE/DELETE raise unless the retention job sets `selloeasy.audit_retention = 'on'` for its transaction.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('selloeasy.audit_retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS accounts_name_trgm_idx ON accounts USING gin (name gin_trgm_ops);
