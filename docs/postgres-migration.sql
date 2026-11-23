-- PostgreSQL migration checklist. Run after creating the database and role.
-- The application still defaults to SQLite; this file is the schema target for the adapter migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
-- Keep this file as the controlled migration entry point. Exported SQLite rows must preserve IDs and timestamps.
-- Required invariants:
--   orders unique (merchant_id, client_request_no), (channel_id, channel_out_trade_no)
--   refund_orders unique refund_no
--   merchant_webhook_deliveries unique (merchant_id, event_id)
--   settlement statements transition with optimistic status checks
INSERT INTO schema_migrations(version) VALUES ('0001-target-schema') ON CONFLICT DO NOTHING;
