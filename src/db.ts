import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { Channel, ChannelStatus, Order, OrderStatus, PublicPaymentEntry, PublicPaymentEntryStatus } from "./types.js";
import { nowIso, randomId } from "./utils.js";
import { decryptSecret, encryptSecret } from "./security/secret-box.js";

const dbDir = path.dirname(path.resolve(config.dbPath));
fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS merchant_subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wechat_apps (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES merchant_subjects(id),
    appid TEXT NOT NULL,
    app_type TEXT NOT NULL DEFAULT 'SERVICE_ACCOUNT',
    oauth_domain TEXT NOT NULL DEFAULT '',
    jsapi_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    UNIQUE(subject_id, appid)
  );
  CREATE TABLE IF NOT EXISTS wechat_merchants (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES merchant_subjects(id),
    mchid TEXT NOT NULL UNIQUE,
    credential_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    complaint_count INTEGER NOT NULL DEFAULT 0,
    risk_enabled INTEGER NOT NULL DEFAULT 1,
    order_window_seconds INTEGER NOT NULL DEFAULT 0,
    order_window_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    daily_success_limit INTEGER NOT NULL DEFAULT 0,
    monitor_locked INTEGER NOT NULL DEFAULT 0,
    monitor_lock_reason TEXT,
    monitor_locked_at TEXT,
    monitor_lock_source TEXT
  );
  CREATE TABLE IF NOT EXISTS app_mch_bindings (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES wechat_apps(id),
    merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id),
    binding_status TEXT NOT NULL DEFAULT 'VERIFIED',
    UNIQUE(app_id, merchant_id)
  );
  CREATE TABLE IF NOT EXISTS merchant_payment_methods (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    app_id TEXT NOT NULL REFERENCES wechat_apps(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    UNIQUE(merchant_id, method)
  );
  CREATE TABLE IF NOT EXISTS wechat_oauth_states (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL UNIQUE,
    app_id TEXT NOT NULL REFERENCES wechat_apps(id),
    return_url TEXT NOT NULL,
    token_hash TEXT,
    openid_ciphertext TEXT,
    context_id TEXT,
    context_type TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    subject_id TEXT NOT NULL REFERENCES merchant_subjects(id),
    app_id TEXT NOT NULL REFERENCES wechat_apps(id),
    merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id),
    notify_path TEXT NOT NULL,
    route_weight INTEGER NOT NULL DEFAULT 100,
    payment_method TEXT NOT NULL DEFAULT 'NATIVE',
    route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED',
    route_cursor INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_merchant_bindings (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id) ON DELETE CASCADE,
    binding_status TEXT NOT NULL DEFAULT 'ACTIVE',
    route_weight INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, merchant_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    platform_order_no TEXT NOT NULL UNIQUE,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    wechat_merchant_id TEXT REFERENCES wechat_merchants(id),
    channel_out_trade_no TEXT NOT NULL,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'NATIVE',
    collection_mode TEXT NOT NULL DEFAULT 'NATIVE',
    payment_app_id TEXT,
    payment_openid_hash TEXT,
    code_url TEXT,
    qr_data_url TEXT,
    transaction_id TEXT,
    route_rule_id TEXT,
    route_snapshot TEXT,
    route_selected_at TEXT,
    client_request_no TEXT NOT NULL,
    user_id TEXT,
    expire_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    device_type TEXT,
    device_ip TEXT,
    device_country TEXT,
    device_province TEXT,
    device_city TEXT,
    device_no TEXT,
    UNIQUE(merchant_id, client_request_no),
    UNIQUE(channel_id, channel_out_trade_no)
  );
  CREATE TABLE IF NOT EXISTS member_blocks (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    source_order_id TEXT REFERENCES orders(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    expires_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_by TEXT,
    revoked_at TEXT,
    revoke_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS member_block_keys (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES member_blocks(id) ON DELETE CASCADE,
    key_type TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    display_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(block_id, key_type, key_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_member_block_keys_lookup ON member_block_keys(key_type, key_hash);
  CREATE INDEX IF NOT EXISTS idx_member_blocks_scope_status ON member_blocks(scope_type, scope_id, status, expires_at);
  CREATE TABLE IF NOT EXISTS member_block_events (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES member_blocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    order_id TEXT REFERENCES orders(id),
    operator TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payment_attempts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    channel_id TEXT NOT NULL REFERENCES channels(id),
    status TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    notification_id TEXT,
    out_trade_no TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(channel_id, notification_id)
  );
  CREATE TABLE IF NOT EXISTS refund_orders (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    refund_no TEXT NOT NULL UNIQUE,
    refund_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    approval_status TEXT NOT NULL DEFAULT 'APPROVED',
    requested_by TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    reject_reason TEXT,
    provider_refund_id TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS route_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_ids TEXT NOT NULL,
    amount_min INTEGER,
    amount_max INTEGER,
    priority INTEGER NOT NULL DEFAULT 100,
    weight INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    operator TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    channel_id TEXT,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reconciliation_bill_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES reconciliation_runs(id),
    channel_id TEXT,
    out_trade_no TEXT,
    transaction_id TEXT,
    amount INTEGER NOT NULL,
    trade_state TEXT NOT NULL,
    refund_amount INTEGER NOT NULL DEFAULT 0,
    match_status TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'OPEN',
    resolution_note TEXT,
    resolved_by TEXT,
    resolved_at TEXT,
    local_order_id TEXT,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, out_trade_no, transaction_id)
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    data_scope TEXT NOT NULL DEFAULT 'ALL',
    data_scope_ids TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES admin_users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_health (
    channel_id TEXT PRIMARY KEY REFERENCES channels(id),
    circuit_state TEXT NOT NULL DEFAULT 'CLOSED',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    last_check_at TEXT,
    last_error TEXT,
    opened_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS callback_tasks (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    notification_id TEXT,
    payload TEXT NOT NULL,
    callback_type TEXT NOT NULL DEFAULT 'TRANSACTION',
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel_id, notification_id)
  );
  CREATE TABLE IF NOT EXISTS bot_settings (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    bot_token TEXT NOT NULL DEFAULT '',
    webhook_url TEXT NOT NULL DEFAULT '',
    admin_group_id TEXT NOT NULL DEFAULT '',
    report_enabled INTEGER NOT NULL DEFAULT 0,
    report_time TEXT NOT NULL DEFAULT '23:30',
    notification_settings TEXT NOT NULL DEFAULT '{}',
    thresholds TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_recipient_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'PLATFORM',
    scope_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(chat_id, scope_type, scope_id)
  );
  CREATE TABLE IF NOT EXISTS bot_delivery_logs (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_group_operators (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'OPERATOR',
    created_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS bot_group_merchants (
    chat_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, merchant_id)
  );
  CREATE TABLE IF NOT EXISTS bot_ledger_entries (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    merchant_id TEXT,
    entry_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT,
    operator_user_id TEXT,
    operator_username TEXT,
    stat_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_merchants (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    settlement_rate REAL NOT NULL DEFAULT 0,
    max_order_amount INTEGER NOT NULL DEFAULT 10000000,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    status_reason TEXT,
    updated_at TEXT,
    last_active_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channel_risk_policies (
    channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    single_ip_payment_limit INTEGER NOT NULL DEFAULT 0,
    consecutive_failure_limit INTEGER NOT NULL DEFAULT 0,
    user_id_payment_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    floating_amount_min INTEGER NOT NULL DEFAULT 0,
    floating_amount_max INTEGER NOT NULL DEFAULT 0,
    amount_min INTEGER NOT NULL DEFAULT 0,
    amount_max INTEGER NOT NULL DEFAULT 0,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    region_blacklist TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS qr_collection_codes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    code_fingerprint TEXT NOT NULL UNIQUE,
    owner_id TEXT,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    qr_type TEXT NOT NULL DEFAULT 'STATIC',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    order_window_seconds INTEGER NOT NULL DEFAULT 0,
    order_window_limit INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS qr_channel_settings (
    channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    route_weight INTEGER NOT NULL DEFAULT 100,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    order_window_seconds INTEGER NOT NULL DEFAULT 0,
    order_window_limit INTEGER NOT NULL DEFAULT 0,
    auto_pause_enabled INTEGER NOT NULL DEFAULT 1,
    failure_rate_threshold INTEGER NOT NULL DEFAULT 0,
    min_orders_for_check INTEGER NOT NULL DEFAULT 5,
    timeout_minutes INTEGER NOT NULL DEFAULT 15,
    alert_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS qr_code_allocations (
    order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    qr_code_id TEXT NOT NULL REFERENCES qr_collection_codes(id),
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_exception_actions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    operator TEXT NOT NULL,
    result TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_merchants (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    login_username TEXT UNIQUE,
    api_key_hash TEXT,
    password_hash TEXT,
    two_factor_secret TEXT,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    password_updated_at TEXT,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    agent_name TEXT,
    group_id TEXT NOT NULL DEFAULT '0',
    group_name TEXT,
    login_ip_allowlist TEXT NOT NULL DEFAULT '',
    withdraw_ip_allowlist TEXT NOT NULL DEFAULT '',
    settlement_rate REAL NOT NULL DEFAULT 0,
    profit_share REAL NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    frozen_amount INTEGER NOT NULL DEFAULT 0,
    prepaid_amount INTEGER NOT NULL DEFAULT 0,
    settlement_amount INTEGER NOT NULL DEFAULT 0,
    withdrawal_fee INTEGER NOT NULL DEFAULT 0,
    withdrawable_amount INTEGER NOT NULL DEFAULT 0,
    total_received INTEGER NOT NULL DEFAULT 0,
    total_refunded INTEGER NOT NULL DEFAULT 0,
    total_settled INTEGER NOT NULL DEFAULT 0,
    balance_warning_amount INTEGER NOT NULL DEFAULT 0,
    single_order_limit INTEGER NOT NULL DEFAULT 0,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS route_rule_versions (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES route_rules(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    change_type TEXT NOT NULL,
    operator TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(rule_id, version)
  );
  CREATE TABLE IF NOT EXISTS client_merchant_ledger (
    id TEXT PRIMARY KEY,
    client_merchant_id TEXT NOT NULL REFERENCES client_merchants(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    available_before INTEGER NOT NULL DEFAULT 0,
    available_after INTEGER NOT NULL DEFAULT 0,
    pending_before INTEGER NOT NULL DEFAULT 0,
    pending_after INTEGER NOT NULL DEFAULT 0,
    frozen_before INTEGER NOT NULL DEFAULT 0,
    frozen_after INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT UNIQUE,
    note TEXT,
    operator TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_merchant_sessions (
    token_hash TEXT PRIMARY KEY,
    client_merchant_id TEXT NOT NULL REFERENCES client_merchants(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_merchant_code_merchants (
    client_merchant_id TEXT NOT NULL REFERENCES client_merchants(id) ON DELETE CASCADE,
    platform_merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    PRIMARY KEY (client_merchant_id, platform_merchant_id)
  );
  CREATE TABLE IF NOT EXISTS client_merchant_channels (
    client_merchant_id TEXT NOT NULL REFERENCES client_merchants(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED',
    route_cursor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (client_merchant_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS platform_merchant_channels (
    platform_merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (platform_merchant_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS platform_merchant_channel_settings (
    platform_merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    route_weight INTEGER NOT NULL DEFAULT 100,
    route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED',
    route_cursor INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (platform_merchant_id, channel_id)
  );
  CREATE TABLE IF NOT EXISTS platform_merchant_wechat_bindings (
    platform_merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    wechat_merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    route_weight INTEGER NOT NULL DEFAULT 100,
    max_concurrency INTEGER NOT NULL DEFAULT 0,
    min_order_amount INTEGER NOT NULL DEFAULT 1,
    max_order_amount INTEGER NOT NULL DEFAULT 0,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (platform_merchant_id, wechat_merchant_id)
  );
  CREATE TABLE IF NOT EXISTS channel_platform_merchant_policies (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    platform_merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    route_weight INTEGER NOT NULL DEFAULT 100,
    max_concurrency INTEGER NOT NULL DEFAULT 0,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, platform_merchant_id)
  );
  CREATE TABLE IF NOT EXISTS route_reservations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    platform_merchant_id TEXT,
    wechat_merchant_id TEXT REFERENCES wechat_merchants(id),
    rule_id TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'RESERVED',
    snapshot TEXT NOT NULL,
    reserved_at TEXT NOT NULL,
    released_at TEXT
  );
  CREATE TABLE IF NOT EXISTS route_allocations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id),
    platform_merchant_id TEXT,
    wechat_merchant_id TEXT REFERENCES wechat_merchants(id),
    rule_id TEXT,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(order_id)
  );
  CREATE TABLE IF NOT EXISTS merchant_sessions (
    token_hash TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_users (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OWNER',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS merchant_user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_request_nonces (
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id),
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (merchant_id, nonce)
  );
  CREATE TABLE IF NOT EXISTS settlement_statements (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id),
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    gross_amount INTEGER NOT NULL,
    refund_amount INTEGER NOT NULL,
    fee_amount INTEGER NOT NULL,
    net_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    note TEXT,
    payment_proof TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    paid_at TEXT
  );
  CREATE TABLE IF NOT EXISTS merchant_webhooks (
    merchant_id TEXT PRIMARY KEY REFERENCES platform_merchants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_webhook_deliveries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(merchant_id, event_id)
  );
  CREATE TABLE IF NOT EXISTS merchant_accounts (
    merchant_id TEXT PRIMARY KEY REFERENCES platform_merchants(id) ON DELETE CASCADE,
    available_balance INTEGER NOT NULL DEFAULT 0,
    pending_settlement INTEGER NOT NULL DEFAULT 0,
    frozen_balance INTEGER NOT NULL DEFAULT 0,
    total_received INTEGER NOT NULL DEFAULT 0,
    total_refunded INTEGER NOT NULL DEFAULT 0,
    total_settled INTEGER NOT NULL DEFAULT 0,
    quota_total INTEGER NOT NULL DEFAULT 0,
    quota_used INTEGER NOT NULL DEFAULT 0,
    quota_reserved INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_credit_ledger (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    quota_before INTEGER NOT NULL,
    quota_after INTEGER NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_ledger_entries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    entry_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    available_before INTEGER NOT NULL,
    available_after INTEGER NOT NULL,
    pending_before INTEGER NOT NULL,
    pending_after INTEGER NOT NULL,
    frozen_before INTEGER NOT NULL,
    frozen_after INTEGER NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_quota_policies (
    merchant_id TEXT PRIMARY KEY REFERENCES platform_merchants(id) ON DELETE CASCADE,
    min_order_amount INTEGER NOT NULL DEFAULT 1,
    max_order_amount INTEGER NOT NULL DEFAULT 10000000,
    daily_amount_limit INTEGER NOT NULL DEFAULT 0,
    daily_order_limit INTEGER NOT NULL DEFAULT 0,
    pending_amount_limit INTEGER NOT NULL DEFAULT 0,
    pending_order_limit INTEGER NOT NULL DEFAULT 0,
    credit_warning_amount INTEGER NOT NULL DEFAULT 0,
    warning_ratio REAL NOT NULL DEFAULT 0.8,
    critical_ratio REAL NOT NULL DEFAULT 0.95,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_quota_reservations (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'RESERVED',
    created_at TEXT NOT NULL,
    released_at TEXT
  );
  CREATE TABLE IF NOT EXISTS merchant_alert_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES platform_merchants(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    level TEXT NOT NULL,
    metric_value REAL NOT NULL,
    threshold REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
`);

for (const migration of [
  "ALTER TABLE settlement_statements ADD COLUMN note TEXT",
  "ALTER TABLE settlement_statements ADD COLUMN payment_proof TEXT",
  "ALTER TABLE wechat_apps ADD COLUMN oauth_domain TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE wechat_apps ADD COLUMN jsapi_path TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'NATIVE'",
  "ALTER TABLE orders ADD COLUMN collection_mode TEXT NOT NULL DEFAULT 'NATIVE'",
  "ALTER TABLE orders ADD COLUMN payment_app_id TEXT",
  "ALTER TABLE orders ADD COLUMN payment_openid_hash TEXT",
  "ALTER TABLE channels ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'NATIVE'",
  "ALTER TABLE channels ADD COLUMN route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED'",
  "ALTER TABLE channels ADD COLUMN route_cursor INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE client_merchant_channels ADD COLUMN route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED'",
  "ALTER TABLE client_merchant_channels ADD COLUMN route_cursor INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE channels ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE platform_merchant_channel_settings ADD COLUMN route_strategy TEXT NOT NULL DEFAULT 'HEALTH_WEIGHTED'",
  "ALTER TABLE platform_merchant_channel_settings ADD COLUMN route_cursor INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE callback_tasks ADD COLUMN callback_type TEXT NOT NULL DEFAULT 'TRANSACTION'",
  "ALTER TABLE refund_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'APPROVED'",
  "ALTER TABLE refund_orders ADD COLUMN requested_by TEXT",
  "ALTER TABLE refund_orders ADD COLUMN reviewed_by TEXT",
  "ALTER TABLE refund_orders ADD COLUMN reviewed_at TEXT",
  "ALTER TABLE refund_orders ADD COLUMN reject_reason TEXT"
  ,"ALTER TABLE merchant_accounts ADD COLUMN quota_total INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE merchant_accounts ADD COLUMN quota_used INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE merchant_accounts ADD COLUMN quota_reserved INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE merchant_quota_policies ADD COLUMN credit_warning_amount INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE platform_merchants ADD COLUMN max_order_amount INTEGER NOT NULL DEFAULT 10000000"
  ,"ALTER TABLE platform_merchants ADD COLUMN daily_amount_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE platform_merchants ADD COLUMN daily_order_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE platform_merchants ADD COLUMN status_reason TEXT"
  ,"ALTER TABLE platform_merchants ADD COLUMN updated_at TEXT"
  ,"ALTER TABLE platform_merchants ADD COLUMN last_active_at TEXT"
  ,"ALTER TABLE wechat_merchants ADD COLUMN daily_amount_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN complaint_count INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN risk_enabled INTEGER NOT NULL DEFAULT 1"
  ,"ALTER TABLE reconciliation_bill_items ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'OPEN'"
  ,"ALTER TABLE reconciliation_bill_items ADD COLUMN resolution_note TEXT"
  ,"ALTER TABLE reconciliation_bill_items ADD COLUMN resolved_by TEXT"
  ,"ALTER TABLE reconciliation_bill_items ADD COLUMN resolved_at TEXT"
  ,"ALTER TABLE orders ADD COLUMN wechat_merchant_id TEXT REFERENCES wechat_merchants(id)"
  ,"ALTER TABLE orders ADD COLUMN client_merchant_id TEXT REFERENCES client_merchants(id)"
  ,"ALTER TABLE orders ADD COLUMN route_rule_id TEXT"
  ,"ALTER TABLE orders ADD COLUMN route_snapshot TEXT"
  ,"ALTER TABLE orders ADD COLUMN route_selected_at TEXT"
  ,"ALTER TABLE orders ADD COLUMN user_id TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_type TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_ip TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_country TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_province TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_city TEXT"
  ,"ALTER TABLE orders ADD COLUMN device_no TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN group_id TEXT NOT NULL DEFAULT '0'"
  ,"ALTER TABLE client_merchants ADD COLUMN group_name TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN login_ip_allowlist TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE client_merchants ADD COLUMN withdraw_ip_allowlist TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE client_merchants ADD COLUMN balance_warning_amount INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN single_order_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN daily_amount_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN password_hash TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN two_factor_secret TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN password_updated_at TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN locked_until TEXT"
  ,"ALTER TABLE client_merchants ADD COLUMN withdrawable_amount INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN total_received INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN total_refunded INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchants ADD COLUMN total_settled INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN available_before INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN available_after INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN pending_before INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN pending_after INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN frozen_before INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN frozen_after INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN idempotency_key TEXT"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN reference_type TEXT"
  ,"ALTER TABLE client_merchant_ledger ADD COLUMN reference_id TEXT"
  ,"ALTER TABLE admin_users ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'ALL'"
  ,"ALTER TABLE admin_users ADD COLUMN data_scope_ids TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE channel_merchant_bindings ADD COLUMN min_order_amount INTEGER NOT NULL DEFAULT 1"
  ,"ALTER TABLE channel_merchant_bindings ADD COLUMN max_order_amount INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE channel_merchant_bindings ADD COLUMN daily_amount_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE channel_risk_policies ADD COLUMN region_blacklist TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE wechat_merchants ADD COLUMN order_window_seconds INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN order_window_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN daily_order_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN daily_success_limit INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN monitor_locked INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE wechat_merchants ADD COLUMN monitor_lock_reason TEXT"
  ,"ALTER TABLE wechat_merchants ADD COLUMN monitor_locked_at TEXT"
  ,"ALTER TABLE wechat_merchants ADD COLUMN monitor_lock_source TEXT"
  ,"ALTER TABLE qr_channel_settings ADD COLUMN auto_pause_enabled INTEGER NOT NULL DEFAULT 1"
  ,"ALTER TABLE qr_channel_settings ADD COLUMN failure_rate_threshold INTEGER NOT NULL DEFAULT 0"
  ,"ALTER TABLE qr_channel_settings ADD COLUMN min_orders_for_check INTEGER NOT NULL DEFAULT 5"
  ,"ALTER TABLE qr_channel_settings ADD COLUMN timeout_minutes INTEGER NOT NULL DEFAULT 15"
  ,"ALTER TABLE qr_channel_settings ADD COLUMN alert_enabled INTEGER NOT NULL DEFAULT 1"
]) {
  try { db.exec(migration); } catch (error) { if (!String(error).includes("duplicate column name")) throw error; }
}

// Each payment channel owns a deterministic callback route so the platform can
// select the matching mchid certificate before decrypting a WeChat notification.
db.prepare("UPDATE channels SET notify_path = '/webhooks/wechatpay/' || id WHERE notify_path IS NULL OR notify_path = ''").run();
db.prepare("UPDATE channels SET name = id WHERE name IS NULL OR name = ''").run();
db.prepare("INSERT OR IGNORE INTO merchant_agents (id, name, status, created_at, updated_at) VALUES ('agent-default', '默认代理', 'ACTIVE', ?, ?)").run(nowIso(), nowIso());
db.prepare("INSERT OR IGNORE INTO merchant_groups (id, name, status, created_at, updated_at) VALUES ('group-default', '默认分组', 'ACTIVE', ?, ?)").run(nowIso(), nowIso());
db.prepare("UPDATE client_merchants SET withdrawable_amount = MAX(0, balance - frozen_amount - settlement_amount) WHERE withdrawable_amount = 0 AND (balance != 0 OR frozen_amount != 0 OR settlement_amount != 0)").run();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_client_merchant_ledger_idem ON client_merchant_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL");
db.exec(`INSERT OR IGNORE INTO route_rule_versions (id, rule_id, version, snapshot, change_type, operator, created_at)
  SELECT 'rversion_legacy_' || r.id, r.id, 1,
    json_object('id', r.id, 'name', r.name, 'channelIds', json(r.channel_ids), 'amountMin', r.amount_min, 'amountMax', r.amount_max, 'priority', r.priority, 'weight', r.weight, 'status', r.status),
    'MIGRATION', 'system', r.created_at FROM route_rules r`);
db.prepare(`INSERT OR IGNORE INTO channel_merchant_bindings (channel_id, merchant_id, created_at)
  SELECT id, merchant_id, created_at FROM channels`).run();
db.prepare("UPDATE orders SET wechat_merchant_id = (SELECT merchant_id FROM channels c WHERE c.id = orders.channel_id) WHERE wechat_merchant_id IS NULL").run();
db.prepare(`INSERT OR IGNORE INTO platform_merchant_wechat_bindings
  (platform_merchant_id, wechat_merchant_id, status, created_at, updated_at)
  SELECT pmc.platform_merchant_id, c.merchant_id, 'ACTIVE', c.created_at, c.created_at
  FROM platform_merchant_channels pmc JOIN channels c ON c.id = pmc.channel_id`).run();
db.prepare(`INSERT OR IGNORE INTO channel_platform_merchant_policies
  (channel_id, platform_merchant_id, status, route_weight, created_at, updated_at)
  SELECT pmc.channel_id, pmc.platform_merchant_id, 'ACTIVE', 100, pmc.created_at, pmc.created_at
  FROM platform_merchant_channels pmc`).run();

// Merchant portal list pages and scoped reports query these columns repeatedly.
// Keep the indexes idempotent so existing SQLite databases receive them on boot.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_merchant_created ON orders(merchant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_merchant_status_created ON orders(merchant_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_wechat_merchant_created ON orders(wechat_merchant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_client_merchant_created ON orders(client_merchant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_orders_channel_created ON orders(channel_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_refund_orders_order_status ON refund_orders(order_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_settlement_statements_merchant_created ON settlement_statements(merchant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_merchant_channels_merchant ON platform_merchant_channels(platform_merchant_id, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_merchant_bindings_merchant_status ON channel_merchant_bindings(merchant_id, binding_status, channel_id);
  CREATE INDEX IF NOT EXISTS idx_client_merchant_ledger_created ON client_merchant_ledger(client_merchant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_merchant_wechat_bindings_merchant ON platform_merchant_wechat_bindings(platform_merchant_id, status);
  CREATE INDEX IF NOT EXISTS idx_platform_merchant_wechat_bindings_wechat ON platform_merchant_wechat_bindings(wechat_merchant_id, status);
  CREATE INDEX IF NOT EXISTS idx_channel_platform_merchant_policies_channel ON channel_platform_merchant_policies(channel_id, status);
  CREATE INDEX IF NOT EXISTS idx_route_reservations_active_channel ON route_reservations(channel_id, status, reserved_at);
  CREATE INDEX IF NOT EXISTS idx_route_reservations_active_platform ON route_reservations(platform_merchant_id, status);
  CREATE INDEX IF NOT EXISTS idx_route_reservations_active_wechat ON route_reservations(wechat_merchant_id, status);
  CREATE INDEX IF NOT EXISTS idx_route_allocations_channel_created ON route_allocations(channel_id, created_at DESC);
`);

db.exec(`INSERT INTO order_events (id, order_id, event_type, from_status, to_status, detail, created_at)
  SELECT 'oevent_legacy_' || o.id, o.id, 'LEGACY_SNAPSHOT', NULL, o.status,
    '{"source":"LEGACY_BACKFILL"}', o.created_at
  FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id)`);

for (const migration of [
  "ALTER TABLE wechat_oauth_states ADD COLUMN context_id TEXT",
  "ALTER TABLE wechat_oauth_states ADD COLUMN context_type TEXT",
  "ALTER TABLE wechat_apps ADD COLUMN verify_file TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE wechat_apps ADD COLUMN verify_token TEXT NOT NULL DEFAULT ''"
]) {
  try { db.exec(migration); } catch (error) { if (!String(error).includes("duplicate column name")) throw error; }
}

// Public-account article payment entries are separate from Native code_url values.
// The token hash is used for lookup; the token itself is only stored encrypted
// so idempotent retries can return the same public URL without exposing it.
db.exec(`
  CREATE TABLE IF NOT EXISTS public_payment_entries (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_ciphertext TEXT,
    page_path TEXT NOT NULL,
    qr_data_url TEXT,
    entry_mode TEXT NOT NULL DEFAULT 'PUBLIC_ACCOUNT_ARTICLE',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_public_payment_entries_expiry ON public_payment_entries(status, expires_at);
  CREATE TABLE IF NOT EXISTS wechat_article_drafts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES public_payment_entries(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL REFERENCES wechat_apps(id),
    draft_media_id TEXT,
    preview_url TEXT,
    qr_media_url TEXT,
    cover_media_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    wechat_errcode TEXT,
    wechat_errmsg TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wechat_article_drafts_status ON wechat_article_drafts(status, updated_at);
  CREATE TABLE IF NOT EXISTS public_payment_events (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
    entry_id TEXT REFERENCES public_payment_entries(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    duration_ms INTEGER,
    error_code TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_public_payment_events_created ON public_payment_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_public_payment_events_type_created ON public_payment_events(event_type, created_at DESC);
  CREATE TABLE IF NOT EXISTS wechat_handoff_tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL REFERENCES public_payment_entries(id) ON DELETE CASCADE,
    ticket_hash TEXT NOT NULL UNIQUE,
    preview_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wechat_handoff_tickets_expiry ON wechat_handoff_tickets(status, expires_at);
`);

try { db.exec("ALTER TABLE public_payment_entries ADD COLUMN token_ciphertext TEXT"); } catch (error) { if (!String(error).includes("duplicate column name")) throw error; }

export function ensureDemoChannel(): void {
  const row = db.prepare("SELECT id FROM channels WHERE id = ?").get("demo-channel") as { id: string } | undefined;
  if (row) return;
  const subjectId = "demo-subject";
  const appId = "demo-app";
  const merchantId = "demo-mch";
  const timestamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO merchant_subjects (id, name, subject_type, created_at) VALUES (?, ?, ?, ?)")
      .run(subjectId, "演示个体工商户", "INDIVIDUAL_BUSINESS", timestamp);
    db.prepare("INSERT INTO wechat_apps (id, subject_id, appid) VALUES (?, ?, ?)")
      .run(appId, subjectId, "wx_demo_service_account");
    db.prepare("INSERT INTO wechat_merchants (id, subject_id, mchid, credential_ref) VALUES (?, ?, ?, ?)")
      .run(merchantId, subjectId, "demo_mchid", "mock");
    db.prepare("INSERT INTO app_mch_bindings (id, app_id, merchant_id) VALUES (?, ?, ?)")
      .run("demo-binding", appId, merchantId);
    db.prepare("INSERT INTO channels (id, subject_id, app_id, merchant_id, notify_path, route_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("demo-channel", subjectId, appId, merchantId, "/webhooks/wechatpay/demo-channel", 100, timestamp);
    db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)")
      .run("demo-channel", merchantId, timestamp);
  });
  tx();
}

export function listChannels(): Channel[] {
  const rows = db.prepare(`
    SELECT c.id, COALESCE(NULLIF(c.name, ''), c.id) AS name, c.subject_id AS subjectId, s.name AS subjectName,
      a.id AS appInternalId, m.id AS merchantInternalId, a.appid AS appId, m.mchid AS mchId, m.credential_ref AS credentialRef,
      (SELECT COUNT(*) FROM channel_merchant_bindings cmb WHERE cmb.channel_id = c.id AND cmb.binding_status = 'ACTIVE') AS merchantCount,
      c.notify_path AS notifyPath, c.route_weight AS routeWeight, c.payment_method AS paymentMethod, COALESCE(c.route_strategy, 'HEALTH_WEIGHTED') AS routeStrategy, c.status,
      a.status AS appStatus, m.status AS merchantStatus
    FROM channels c
    JOIN merchant_subjects s ON s.id = c.subject_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = c.merchant_id
    ORDER BY c.created_at DESC
  `).all() as Channel[];
  return rows.map((channel) => ({ ...channel, merchantIds: db.prepare("SELECT merchant_id AS merchantId FROM channel_merchant_bindings WHERE channel_id = ? AND binding_status = 'ACTIVE' ORDER BY created_at").all(channel.id).map((item) => String((item as { merchantId: string }).merchantId)) })) as Channel[];
}

export function updateChannelRouteStrategy(channelId: string, routeStrategy: MerchantRouteStrategy): Channel | undefined {
  if (!["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"].includes(routeStrategy)) throw new Error("INVALID_ROUTE_STRATEGY");
  if (!getChannel(channelId)) return undefined;
  db.prepare("UPDATE channels SET route_strategy = ?, route_cursor = CASE WHEN route_strategy = ? THEN route_cursor ELSE 0 END WHERE id = ?").run(routeStrategy, routeStrategy, channelId);
  return getChannel(channelId);
}

export function ensureChannelRiskPolicy(channelId: string): void {
  db.prepare(`INSERT OR IGNORE INTO channel_risk_policies (channel_id, updated_at) VALUES (?, ?)`).run(channelId, nowIso());
}

export function getChannelRiskPolicy(channelId: string): Record<string, unknown> | undefined {
  if (!getChannel(channelId)) return undefined;
  ensureChannelRiskPolicy(channelId);
  return db.prepare(`SELECT channel_id AS channelId, single_ip_payment_limit AS singleIpPaymentLimit,
    consecutive_failure_limit AS consecutiveFailureLimit, user_id_payment_limit AS userIdPaymentLimit,
    daily_order_limit AS dailyOrderLimit, floating_amount_min AS floatingAmountMin, floating_amount_max AS floatingAmountMax,
    amount_min AS amountMin, amount_max AS amountMax, daily_amount_limit AS dailyAmountLimit, region_blacklist AS regionBlacklist, updated_at AS updatedAt
    FROM channel_risk_policies WHERE channel_id = ?`).get(channelId) as Record<string, unknown>;
}

export interface ChannelOrderRiskInput {
  amount: number;
  deviceIp?: string | null;
  userId?: string | null;
  deviceCountry?: string | null;
  deviceProvince?: string | null;
  deviceCity?: string | null;
}

export interface ChannelOrderRiskResult {
  allowed: boolean;
  reason?: string;
  dailyOrderCount: number;
  dailyAmount: number;
  ipOrderCount: number;
  userOrderCount: number;
  consecutiveFailures: number;
  policy: Record<string, unknown>;
}

export function checkChannelOrderRisk(channelId: string, input: ChannelOrderRiskInput): ChannelOrderRiskResult {
  const policy = getChannelRiskPolicy(channelId) ?? {};
  const empty: ChannelOrderRiskResult = { allowed: true, dailyOrderCount: 0, dailyAmount: 0, ipOrderCount: 0, userOrderCount: 0, consecutiveFailures: 0, policy };
  const amount = Number(input.amount || 0);
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const usage = db.prepare(`SELECT COUNT(*) AS orderCount, COALESCE(SUM(amount), 0) AS amount
    FROM orders WHERE channel_id = ? AND status NOT IN ('FAILED', 'CLOSED') AND date(created_at, '+8 hours') = ?`).get(channelId, day) as { orderCount: number; amount: number };
  const ipOrderCount = input.deviceIp ? Number((db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE channel_id = ? AND device_ip = ? AND status NOT IN ('FAILED', 'CLOSED') AND date(created_at, '+8 hours') = ?`).get(channelId, input.deviceIp, day) as { count: number }).count) : 0;
  const userOrderCount = input.userId ? Number((db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE channel_id = ? AND user_id = ? AND status NOT IN ('FAILED', 'CLOSED') AND date(created_at, '+8 hours') = ?`).get(channelId, input.userId, day) as { count: number }).count) : 0;
  const health = db.prepare("SELECT COALESCE(consecutive_failures, 0) AS failures FROM channel_health WHERE channel_id = ?").get(channelId) as { failures?: number } | undefined;
  const consecutiveFailures = Number(health?.failures || 0);
  const blacklist = String(policy.regionBlacklist || '').split(/[，,]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  const regions = [input.deviceCountry, input.deviceProvince, input.deviceCity].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  const blockedRegion = blacklist.find((item) => regions.some((region) => region === item || region.includes(item) || item.includes(region)));
  let reason: string | undefined;
  if (Number(policy.amountMin || 0) > 0 && amount < Number(policy.amountMin)) reason = 'CHANNEL_AMOUNT_BELOW_MINIMUM';
  else if (Number(policy.amountMax || 0) > 0 && amount > Number(policy.amountMax)) reason = 'CHANNEL_AMOUNT_ABOVE_MAXIMUM';
  else if (Number(policy.dailyOrderLimit || 0) > 0 && Number(usage.orderCount) >= Number(policy.dailyOrderLimit)) reason = 'CHANNEL_DAILY_ORDER_LIMIT_EXCEEDED';
  else if (Number(policy.dailyAmountLimit || 0) > 0 && Number(usage.amount) + amount > Number(policy.dailyAmountLimit)) reason = 'CHANNEL_DAILY_AMOUNT_LIMIT_EXCEEDED';
  else if (Number(policy.singleIpPaymentLimit || 0) > 0 && ipOrderCount >= Number(policy.singleIpPaymentLimit)) reason = 'CHANNEL_IP_LIMIT_EXCEEDED';
  else if (Number(policy.userIdPaymentLimit || 0) > 0 && userOrderCount >= Number(policy.userIdPaymentLimit)) reason = 'CHANNEL_USER_LIMIT_EXCEEDED';
  else if (Number(policy.consecutiveFailureLimit || 0) > 0 && consecutiveFailures >= Number(policy.consecutiveFailureLimit)) reason = 'CHANNEL_FAILURE_LIMIT_EXCEEDED';
  else if (blockedRegion) reason = 'CHANNEL_REGION_BLOCKED';
  return { allowed: !reason, reason, dailyOrderCount: Number(usage.orderCount || 0), dailyAmount: Number(usage.amount || 0), ipOrderCount, userOrderCount, consecutiveFailures, policy };
}

export type MemberBlockScopeType = "GLOBAL" | "PLATFORM_MERCHANT" | "CHANNEL";
export type MemberBlockKeyType = "MEMBER_ID" | "OPENID_HASH" | "IP" | "DEVICE_ID";

export interface MemberBlockKeyInput {
  keyType: MemberBlockKeyType;
  value: string;
}

export interface MemberBlockMatchInput {
  platformMerchantId?: string | null;
  channelId?: string | null;
  keys: MemberBlockKeyInput[];
}

function memberBlockKeyHash(keyType: MemberBlockKeyType, value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  return crypto.createHash("sha256").update(`${keyType}:${normalized}`, "utf8").digest("hex");
}

function memberBlockDisplayValue(keyType: MemberBlockKeyType, value: string): string {
  const normalized = String(value || "").trim();
  if (keyType === "IP") return normalized;
  if (normalized.length <= 6) return `${normalized.slice(0, 2)}***`;
  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}

function expireMemberBlocks(): void {
  db.prepare("UPDATE member_blocks SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?").run(nowIso());
}

function normalizeMemberBlockRow(row: Record<string, unknown>, keys: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    id: String(row.id),
    scopeType: String(row.scopeType ?? row.scope_type ?? "GLOBAL"),
    scopeId: row.scopeId ?? row.scope_id ?? null,
    sourceOrderId: row.sourceOrderId ?? row.source_order_id ?? null,
    sourcePlatformOrderNo: row.sourcePlatformOrderNo ?? row.source_platform_order_no ?? null,
    reason: String(row.reason || ""),
    status: String(row.status || "ACTIVE"),
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    createdBy: String(row.createdBy ?? row.created_by ?? ""),
    createdAt: row.createdAt ?? row.created_at ?? null,
    revokedBy: row.revokedBy ?? row.revoked_by ?? null,
    revokedAt: row.revokedAt ?? row.revoked_at ?? null,
    revokeReason: row.revokeReason ?? row.revoke_reason ?? null,
    keys
  };
}

export function createMemberBlock(input: {
  scopeType: MemberBlockScopeType;
  scopeId?: string | null;
  sourceOrderId?: string | null;
  reason: string;
  expiresAt?: string | null;
  createdBy: string;
  keys: MemberBlockKeyInput[];
}): Record<string, unknown> {
  const keys = input.keys.filter((item, index, all) => item.value.trim() && all.findIndex((other) => other.keyType === item.keyType && other.value.trim().toLowerCase() === item.value.trim().toLowerCase()) === index);
  if (!keys.length) throw new Error("MEMBER_BLOCK_KEY_REQUIRED");
  const id = randomId("block");
  const createdAt = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO member_blocks (id, scope_type, scope_id, source_order_id, reason, status, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).run(id, input.scopeType, input.scopeId ?? null, input.sourceOrderId ?? null, input.reason.trim(), input.expiresAt ?? null, input.createdBy, createdAt);
    const insertKey = db.prepare(`INSERT INTO member_block_keys (id, block_id, key_type, key_hash, display_value, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of keys) insertKey.run(randomId("block-key"), id, item.keyType, memberBlockKeyHash(item.keyType, item.value), memberBlockDisplayValue(item.keyType, item.value), createdAt);
    db.prepare(`INSERT INTO member_block_events (id, block_id, event_type, order_id, operator, detail, created_at) VALUES (?, ?, 'CREATE', ?, ?, ?, ?)`)
      .run(randomId("block-event"), id, input.sourceOrderId ?? null, input.createdBy, JSON.stringify({ scopeType: input.scopeType, scopeId: input.scopeId ?? null, keyTypes: keys.map((item) => item.keyType), reason: input.reason.trim() }), createdAt);
  });
  tx();
  return getMemberBlock(id)!;
}

export function getMemberBlock(id: string): Record<string, unknown> | undefined {
  expireMemberBlocks();
  const row = db.prepare(`SELECT b.*, o.platform_order_no AS sourcePlatformOrderNo
    FROM member_blocks b LEFT JOIN orders o ON o.id = b.source_order_id WHERE b.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const keys = db.prepare(`SELECT key_type AS keyType, display_value AS displayValue, created_at AS createdAt
    FROM member_block_keys WHERE block_id = ? ORDER BY created_at`).all(id) as Array<Record<string, unknown>>;
  const events = db.prepare(`SELECT id, event_type AS eventType, order_id AS orderId, operator, detail, created_at AS createdAt
    FROM member_block_events WHERE block_id = ? ORDER BY created_at DESC`).all(id) as Array<Record<string, unknown>>;
  return { ...normalizeMemberBlockRow(row, keys), events: events.map((event) => ({ ...event, detail: (() => { try { return JSON.parse(String(event.detail || "{}")); } catch { return {}; } })() })) };
}

export function listMemberBlocks(input: { query?: string; status?: string; limit?: number } = {}): Array<Record<string, unknown>> {
  expireMemberBlocks();
  const rows = db.prepare(`SELECT b.*, o.platform_order_no AS sourcePlatformOrderNo
    FROM member_blocks b LEFT JOIN orders o ON o.id = b.source_order_id ORDER BY b.created_at DESC LIMIT ?`).all(Math.max(1, Math.min(Number(input.limit || 200), 1000))) as Array<Record<string, unknown>>;
  const query = String(input.query || "").trim().toLowerCase();
  const status = String(input.status || "").trim().toUpperCase();
  return rows.map((row) => normalizeMemberBlockRow(row, db.prepare(`SELECT key_type AS keyType, display_value AS displayValue, created_at AS createdAt FROM member_block_keys WHERE block_id = ? ORDER BY created_at`).all(row.id) as Array<Record<string, unknown>>))
    .filter((row) => (!status || String(row.status) === status) && (!query || [row.id, row.scopeType, row.scopeId, row.sourcePlatformOrderNo, row.reason, ...(row.keys as Array<Record<string, unknown>>).flatMap((key) => [key.keyType, key.displayValue])].some((value) => String(value || "").toLowerCase().includes(query))));
}

export function findActiveMemberBlock(input: MemberBlockMatchInput): { block: Record<string, unknown>; keyType: MemberBlockKeyType; displayValue: string } | undefined {
  expireMemberBlocks();
  const candidates = input.keys.filter((item) => item.value.trim()).map((item) => ({ ...item, keyHash: memberBlockKeyHash(item.keyType, item.value) }));
  if (!candidates.length) return undefined;
  const rows = db.prepare(`SELECT b.*, k.key_type AS matchedKeyType, k.key_hash AS matchedKeyHash, k.display_value AS matchedDisplayValue, o.platform_order_no AS sourcePlatformOrderNo
    FROM member_block_keys k JOIN member_blocks b ON b.id = k.block_id LEFT JOIN orders o ON o.id = b.source_order_id
    WHERE b.status = 'ACTIVE' AND (b.expires_at IS NULL OR b.expires_at > ?) AND k.key_hash IN (${candidates.map(() => "?").join(",")})
    ORDER BY CASE b.scope_type WHEN 'GLOBAL' THEN 1 WHEN 'PLATFORM_MERCHANT' THEN 2 ELSE 3 END, b.created_at DESC`).all(nowIso(), ...candidates.map((item) => item.keyHash)) as Array<Record<string, unknown>>;
  const candidateHashes = new Set(candidates.map((item) => item.keyHash));
  for (const row of rows) {
    const scopeType = String(row.scope_type);
    const scopeId = String(row.scope_id || "");
    const inScope = scopeType === "GLOBAL" || (scopeType === "PLATFORM_MERCHANT" && scopeId === String(input.platformMerchantId || "")) || (scopeType === "CHANNEL" && scopeId === String(input.channelId || ""));
    if (inScope && candidateHashes.has(String(row.matchedKeyHash || ""))) {
      return { block: normalizeMemberBlockRow(row), keyType: String(row.matchedKeyType) as MemberBlockKeyType, displayValue: String(row.matchedDisplayValue || "") };
    }
  }
  return undefined;
}

export function revokeMemberBlock(id: string, operator: string, reason: string): Record<string, unknown> | undefined {
  const current = getMemberBlock(id);
  if (!current) return undefined;
  if (String(current.status) !== "ACTIVE") return current;
  const revokedAt = nowIso();
  const tx = db.transaction(() => {
    db.prepare("UPDATE member_blocks SET status = 'REVOKED', revoked_by = ?, revoked_at = ?, revoke_reason = ? WHERE id = ? AND status = 'ACTIVE'").run(operator, revokedAt, reason.trim() || null, id);
    db.prepare(`INSERT INTO member_block_events (id, block_id, event_type, operator, detail, created_at) VALUES (?, ?, 'REVOKE', ?, ?, ?)`)
      .run(randomId("block-event"), id, operator, JSON.stringify({ reason: reason.trim() || "" }), revokedAt);
  });
  tx();
  return getMemberBlock(id);
}

export function updateChannelRiskPolicy(channelId: string, input: {
  singleIpPaymentLimit?: number;
  consecutiveFailureLimit?: number;
  userIdPaymentLimit?: number;
  dailyOrderLimit?: number;
  floatingAmountMin?: number;
  floatingAmountMax?: number;
  amountMin?: number;
  amountMax?: number;
  dailyAmountLimit?: number;
  regionBlacklist?: string;
}): Record<string, unknown> | undefined {
  if (!getChannel(channelId)) return undefined;
  ensureChannelRiskPolicy(channelId);
  const current = getChannelRiskPolicy(channelId)!;
  const values = {
    singleIpPaymentLimit: input.singleIpPaymentLimit ?? Number(current.singleIpPaymentLimit || 0),
    consecutiveFailureLimit: input.consecutiveFailureLimit ?? Number(current.consecutiveFailureLimit || 0),
    userIdPaymentLimit: input.userIdPaymentLimit ?? Number(current.userIdPaymentLimit || 0),
    dailyOrderLimit: input.dailyOrderLimit ?? Number(current.dailyOrderLimit || 0),
    floatingAmountMin: input.floatingAmountMin ?? Number(current.floatingAmountMin || 0),
    floatingAmountMax: input.floatingAmountMax ?? Number(current.floatingAmountMax || 0),
    amountMin: input.amountMin ?? Number(current.amountMin || 0),
    amountMax: input.amountMax ?? Number(current.amountMax || 0),
    dailyAmountLimit: input.dailyAmountLimit ?? Number(current.dailyAmountLimit || 0),
    regionBlacklist: String(input.regionBlacklist ?? String(current.regionBlacklist || '')).split(/[，,]/).map((item) => item.trim()).filter(Boolean).join(',')
  };
  if (values.floatingAmountMax > 0 && values.floatingAmountMax < values.floatingAmountMin) throw new Error("FLOATING_AMOUNT_RANGE_INVALID");
  if (values.amountMax > 0 && values.amountMax < values.amountMin) throw new Error("AMOUNT_RANGE_INVALID");
  db.prepare(`UPDATE channel_risk_policies SET single_ip_payment_limit = ?, consecutive_failure_limit = ?, user_id_payment_limit = ?,
    daily_order_limit = ?, floating_amount_min = ?, floating_amount_max = ?, amount_min = ?, amount_max = ?, daily_amount_limit = ?, region_blacklist = ?, updated_at = ?
    WHERE channel_id = ?`).run(values.singleIpPaymentLimit, values.consecutiveFailureLimit, values.userIdPaymentLimit,
    values.dailyOrderLimit, values.floatingAmountMin, values.floatingAmountMax, values.amountMin, values.amountMax, values.dailyAmountLimit, values.regionBlacklist, nowIso(), channelId);
  return getChannelRiskPolicy(channelId);
}

export function getChannel(id: string): Channel | undefined {
  return db.prepare(`
    SELECT c.id, COALESCE(NULLIF(c.name, ''), c.id) AS name, c.subject_id AS subjectId, s.name AS subjectName,
      a.id AS appInternalId, m.id AS merchantInternalId, a.appid AS appId, m.mchid AS mchId, m.credential_ref AS credentialRef,
      (SELECT COUNT(*) FROM channel_merchant_bindings cmb WHERE cmb.channel_id = c.id AND cmb.binding_status = 'ACTIVE') AS merchantCount,
      c.notify_path AS notifyPath, c.route_weight AS routeWeight, c.payment_method AS paymentMethod, c.status,
      a.status AS appStatus, m.status AS merchantStatus
    FROM channels c
    JOIN merchant_subjects s ON s.id = c.subject_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = c.merchant_id
    WHERE c.id = ?
  `).get(id) as Channel | undefined;
}

export function listChannelMerchants(channelId: string): Array<Record<string, unknown>> {
  const channel = getChannel(channelId);
  const paymentMethod: ChannelPaymentMethod = channel?.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
  const rows = db.prepare(`
    SELECT m.id, m.mchid, m.credential_ref AS credentialRef, m.status,
      m.daily_amount_limit AS merchantDailyAmountLimit, m.complaint_count AS complaintCount, m.risk_enabled AS riskEnabled,
      m.order_window_seconds AS orderWindowSeconds, m.order_window_limit AS orderWindowLimit,
      m.daily_order_limit AS merchantDailyOrderLimit, m.daily_success_limit AS dailySuccessLimit,
      m.subject_id AS subjectId, s.name AS subjectName,
      COALESCE((SELECT pm.app_id FROM merchant_payment_methods pm WHERE pm.merchant_id = m.id AND pm.method = 'NATIVE' AND pm.status = 'ACTIVE' ORDER BY pm.created_at LIMIT 1),
        (SELECT amb.app_id FROM app_mch_bindings amb WHERE amb.merchant_id = m.id ORDER BY amb.id LIMIT 1)) AS appInternalId,
      COALESCE((SELECT a2.appid FROM merchant_payment_methods pm2 JOIN wechat_apps a2 ON a2.id = pm2.app_id WHERE pm2.merchant_id = m.id AND pm2.method = 'NATIVE' AND pm2.status = 'ACTIVE' ORDER BY pm2.created_at LIMIT 1),
        (SELECT a3.appid FROM app_mch_bindings amb2 JOIN wechat_apps a3 ON a3.id = amb2.app_id WHERE amb2.merchant_id = m.id ORDER BY amb2.id LIMIT 1)) AS appId,
      COALESCE((SELECT a4.status FROM merchant_payment_methods pm3 JOIN wechat_apps a4 ON a4.id = pm3.app_id WHERE pm3.merchant_id = m.id AND pm3.method = 'NATIVE' AND pm3.status = 'ACTIVE' ORDER BY pm3.created_at LIMIT 1),
        (SELECT a5.status FROM app_mch_bindings amb3 JOIN wechat_apps a5 ON a5.id = amb3.app_id WHERE amb3.merchant_id = m.id ORDER BY amb3.id LIMIT 1), 'DISABLED') AS appStatus,
      cmb.binding_status AS bindingStatus, cmb.route_weight AS routeWeight,
      cmb.min_order_amount AS minOrderAmount, cmb.max_order_amount AS maxOrderAmount,
      cmb.daily_amount_limit AS dailyAmountLimit,
      cmb.created_at AS boundAt
    FROM channel_merchant_bindings cmb
    JOIN channels c ON c.id = cmb.channel_id
    JOIN wechat_merchants m ON m.id = cmb.merchant_id
    JOIN merchant_subjects s ON s.id = m.subject_id
    WHERE cmb.channel_id = ? ORDER BY m.mchid
    `).all(channelId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const app = paymentAppForMerchant(String(row.id), paymentMethod);
    return app ? { ...row, appInternalId: app.id, appId: app.appid, appStatus: app.status } : { ...row, appInternalId: "", appId: "", appStatus: "DISABLED" };
  });
}

export function updateChannelMerchantBinding(channelId: string, merchantId: string, input: { bindingStatus?: "ACTIVE" | "DISABLED"; routeWeight?: number; minOrderAmount?: number; maxOrderAmount?: number; dailyAmountLimit?: number }): Record<string, unknown> | undefined {
  const binding = db.prepare("SELECT channel_id AS channelId, merchant_id AS merchantId FROM channel_merchant_bindings WHERE channel_id = ? AND merchant_id = ?").get(channelId, merchantId);
  if (!binding) return undefined;
  if (input.bindingStatus === "DISABLED") {
    const activeCount = Number((db.prepare("SELECT COUNT(*) AS count FROM channel_merchant_bindings WHERE channel_id = ? AND binding_status = 'ACTIVE'").get(channelId) as { count: number }).count);
    if (activeCount <= 1) throw new Error("CHANNEL_MERCHANT_REQUIRED");
  }
  const min = input.minOrderAmount == null ? null : Math.floor(input.minOrderAmount);
  const max = input.maxOrderAmount == null ? null : Math.floor(input.maxOrderAmount);
  const daily = input.dailyAmountLimit == null ? null : Math.floor(input.dailyAmountLimit);
  if (min != null && min < 1) throw new Error("INVALID_BINDING_MIN_AMOUNT");
  if (max != null && max < 0) throw new Error("INVALID_BINDING_MAX_AMOUNT");
  if (max != null && max > 0 && min != null && max < min) throw new Error("BINDING_AMOUNT_RANGE_INVALID");
  if (daily != null && daily < 0) throw new Error("INVALID_BINDING_DAILY_LIMIT");
  db.prepare(`UPDATE channel_merchant_bindings SET binding_status = COALESCE(?, binding_status), route_weight = COALESCE(?, route_weight), min_order_amount = COALESCE(?, min_order_amount), max_order_amount = COALESCE(?, max_order_amount), daily_amount_limit = COALESCE(?, daily_amount_limit) WHERE channel_id = ? AND merchant_id = ?`)
    .run(input.bindingStatus ?? null, input.routeWeight ?? null, min, max, daily, channelId, merchantId);
  return listChannelMerchants(channelId).find((item) => String(item.id) === merchantId);
}

export function setChannelMerchantBindings(channelId: string, merchantIds: string[]): Array<Record<string, unknown>> {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const uniqueIds = [...new Set(merchantIds)];
  if (!uniqueIds.length) throw new Error("CHANNEL_MERCHANT_REQUIRED");
  const merchants = uniqueIds.map((id) => db.prepare("SELECT id, subject_id AS subjectId, status FROM wechat_merchants WHERE id = ?").get(id) as { id: string; subjectId: string; status: string } | undefined);
  if (merchants.some((merchant) => !merchant)) throw new Error("MERCHANT_NOT_FOUND");
  const paymentMethod: ChannelPaymentMethod = channel.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
  const paymentApps = uniqueIds.map((merchantId) => paymentAppForMerchant(merchantId, paymentMethod));
  if (paymentApps.some((app) => !app || app.status !== "ACTIVE")) throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
  const current = new Set(listChannelMerchants(channelId).filter((merchant) => merchant.bindingStatus === 'ACTIVE').map((merchant) => String(merchant.id)));
  const removingInUseBinding = [...current].filter((merchantId) => !uniqueIds.includes(merchantId)).some((merchantId) => {
    const row = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE channel_id = ? AND wechat_merchant_id = ?").get(channelId, merchantId) as { count: number };
    return Number(row.count) > 0;
  });
  if (removingInUseBinding) throw new Error("CHANNEL_MERCHANT_IN_USE");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM channel_merchant_bindings WHERE channel_id = ?").run(channelId);
    const insert = db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, binding_status, created_at) VALUES (?, ?, 'ACTIVE', ?)");
    for (const merchantId of uniqueIds) insert.run(channelId, merchantId, nowIso());
    const primary = channel.merchantInternalId && uniqueIds.includes(channel.merchantInternalId) ? channel.merchantInternalId : uniqueIds[0];
    const primaryApp = paymentAppForMerchant(primary, paymentMethod);
    if (primaryApp) db.prepare("UPDATE channels SET subject_id = ?, app_id = ?, merchant_id = ? WHERE id = ?").run(primaryApp.subjectId, primaryApp.id, primary, channelId);
    else db.prepare("UPDATE channels SET merchant_id = ? WHERE id = ?").run(primary, channelId);
  });
  tx();
  return listChannelMerchants(channelId);
}

export function listMerchantBoundChannelIds(merchantId: string): string[] {
  return db.prepare("SELECT channel_id AS channelId FROM channel_merchant_bindings WHERE merchant_id = ? AND binding_status = 'ACTIVE' ORDER BY channel_id").all(merchantId).map((row) => String((row as { channelId: string }).channelId));
}

export function setMerchantChannelBindings(merchantId: string, channelIds: string[]): Channel[] {
  const merchant = db.prepare("SELECT id, subject_id AS subjectId FROM wechat_merchants WHERE id = ?").get(merchantId) as { id: string; subjectId: string } | undefined;
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  const uniqueIds = [...new Set(channelIds)];
  const channels = uniqueIds.map((channelId) => getChannel(channelId));
  if (channels.some((channel) => !channel)) throw new Error("CHANNEL_NOT_FOUND");
  for (const channel of channels) {
    if (!channel) continue;
    const paymentMethod: ChannelPaymentMethod = channel.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
    const app = paymentAppForMerchant(merchantId, paymentMethod);
    if (!app || app.status !== "ACTIVE") throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
  }
  const current = new Set(listMerchantBoundChannelIds(merchantId));
  const removingLastBinding = [...current].filter((channelId) => !uniqueIds.includes(channelId)).some((channelId) => {
    const row = db.prepare("SELECT COUNT(*) AS count FROM channel_merchant_bindings WHERE channel_id = ? AND binding_status = 'ACTIVE'").get(channelId) as { count: number };
    return Number(row.count) <= 1;
  });
  if (removingLastBinding) throw new Error("CHANNEL_MERCHANT_REQUIRED");
  const removingInUseBinding = [...current].filter((channelId) => !uniqueIds.includes(channelId)).some((channelId) => {
    const row = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE channel_id = ? AND wechat_merchant_id = ?").get(channelId, merchantId) as { count: number };
    return Number(row.count) > 0;
  });
  if (removingInUseBinding) throw new Error("CHANNEL_MERCHANT_IN_USE");
  const tx = db.transaction(() => {
    for (const channelId of current) {
      if (uniqueIds.includes(channelId)) continue;
      const count = Number((db.prepare("SELECT COUNT(*) AS count FROM channel_merchant_bindings WHERE channel_id = ? AND binding_status = 'ACTIVE'").get(channelId) as { count: number }).count);
      if (count > 1) db.prepare("DELETE FROM channel_merchant_bindings WHERE channel_id = ? AND merchant_id = ?").run(channelId, merchantId);
    }
    for (const channel of channels) {
      if (!channel) continue;
      db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, binding_status, created_at) VALUES (?, ?, 'ACTIVE', ?) ON CONFLICT(channel_id, merchant_id) DO UPDATE SET binding_status = 'ACTIVE'").run(channel.id, merchantId, nowIso());
      if (channel.merchantInternalId === UNBOUND_MERCHANT_ID) {
        const paymentMethod: ChannelPaymentMethod = channel.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
        const app = paymentAppForMerchant(merchantId, paymentMethod);
        if (app) db.prepare("UPDATE channels SET subject_id = ?, app_id = ?, merchant_id = ? WHERE id = ?").run(app.subjectId, app.id, merchantId, channel.id);
      }
    }
    for (const channelId of current) {
      const primary = db.prepare("SELECT merchant_id AS merchantId FROM channel_merchant_bindings WHERE channel_id = ? AND binding_status = 'ACTIVE' ORDER BY created_at LIMIT 1").get(channelId) as { merchantId: string } | undefined;
      if (primary) {
        const channel = getChannel(channelId);
        const paymentMethod: ChannelPaymentMethod = channel?.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
        const app = paymentAppForMerchant(primary.merchantId, paymentMethod);
        if (app) db.prepare("UPDATE channels SET subject_id = ?, app_id = ?, merchant_id = ? WHERE id = ?").run(app.subjectId, app.id, primary.merchantId, channelId);
        else db.prepare("UPDATE channels SET merchant_id = ? WHERE id = ?").run(primary.merchantId, channelId);
      }
    }
  });
  tx();
  return uniqueIds.map((channelId) => getChannel(channelId)).filter(Boolean) as Channel[];
}

export function resolveChannelMerchant(channelId: string, merchantId?: string | null): Channel | undefined {
  const channel = getChannel(channelId);
  if (!channel) return undefined;
  const selectedId = merchantId || channel.merchantInternalId;
  const merchant = listChannelMerchants(channelId).find((item) => String(item.id) === String(selectedId) && String(item.bindingStatus) === 'ACTIVE') as Record<string, unknown> | undefined;
  if (!merchant) return merchantId ? undefined : channel;
  return { ...channel, appInternalId: String(merchant.appInternalId || channel.appInternalId || ''), appId: String(merchant.appId || channel.appId || ''), appStatus: String(merchant.appStatus || channel.appStatus || 'ACTIVE'), merchantInternalId: String(merchant.id), mchId: String(merchant.mchid), credentialRef: String(merchant.credentialRef), merchantStatus: String(merchant.status) };
}

export function resolveChannelMerchantByMchid(channelId: string, mchid: string): Channel | undefined {
  const channel = getChannel(channelId);
  if (!channel) return undefined;
  const merchant = db.prepare(`SELECT m.id, m.mchid, m.credential_ref AS credentialRef, m.status,
      COALESCE((SELECT pm.app_id FROM merchant_payment_methods pm WHERE pm.merchant_id = m.id AND pm.method = 'NATIVE' AND pm.status = 'ACTIVE' ORDER BY pm.created_at LIMIT 1), (SELECT amb.app_id FROM app_mch_bindings amb WHERE amb.merchant_id = m.id ORDER BY amb.id LIMIT 1)) AS appInternalId,
      COALESCE((SELECT a.appid FROM merchant_payment_methods pm JOIN wechat_apps a ON a.id = pm.app_id WHERE pm.merchant_id = m.id AND pm.method = 'NATIVE' AND pm.status = 'ACTIVE' ORDER BY pm.created_at LIMIT 1), (SELECT a2.appid FROM app_mch_bindings amb2 JOIN wechat_apps a2 ON a2.id = amb2.app_id WHERE amb2.merchant_id = m.id ORDER BY amb2.id LIMIT 1)) AS appId
    FROM wechat_merchants m
    WHERE m.mchid = ? AND (m.id = (SELECT merchant_id FROM channels WHERE id = ?)
      OR EXISTS (SELECT 1 FROM channel_merchant_bindings cmb WHERE cmb.channel_id = ? AND cmb.merchant_id = m.id AND cmb.binding_status = 'ACTIVE'))`).get(mchid, channelId, channelId) as { id: string; mchid: string; credentialRef: string; status: string } | undefined;
  return merchant ? { ...channel, appInternalId: String((merchant as any).appInternalId || channel.appInternalId || ''), appId: String((merchant as any).appId || channel.appId || ''), merchantInternalId: merchant.id, mchId: merchant.mchid, credentialRef: merchant.credentialRef, merchantStatus: merchant.status } : undefined;
}

export function selectChannelMerchant(channelId: string, amount = 0): Channel | undefined {
  const channel = getChannel(channelId);
  if (!channel) return undefined;
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const boundMerchants = listChannelMerchants(channelId);
  const merchants = listChannelMerchants(channelId).filter((merchant) => {
    if (merchant.status !== 'ACTIVE' || merchant.bindingStatus !== 'ACTIVE') return false;
    const min = Number(merchant.minOrderAmount || 1); const max = Number(merchant.maxOrderAmount || 0);
    if (amount > 0 && (amount < min || (max > 0 && amount > max))) return false;
    const merchantDailyLimit = Number(merchant.merchantDailyAmountLimit || 0);
    const bindingDailyLimit = Number(merchant.dailyAmountLimit || 0);
    const effectiveDailyLimit = merchantDailyLimit > 0 && bindingDailyLimit > 0 ? Math.min(merchantDailyLimit, bindingDailyLimit) : merchantDailyLimit || bindingDailyLimit;
    if (amount > 0 && effectiveDailyLimit > 0) {
      const used = Number((db.prepare(`SELECT COALESCE(SUM(o.amount), 0) AS amount FROM orders o WHERE o.channel_id = ? AND o.wechat_merchant_id = ? AND o.status = 'SUCCESS' AND substr(o.created_at, 1, 10) = ?`).get(channelId, merchant.id, day) as { amount: number }).amount);
      if (used + amount > effectiveDailyLimit) return false;
    }
    return true;
  });
  if (!merchants.length) return boundMerchants.length ? undefined : channel;
  const total = merchants.reduce((sum, merchant) => sum + Math.max(Number(merchant.routeWeight || 100), 1), 0);
  let cursor = Math.random() * total;
  const selected = merchants.find((merchant) => { cursor -= Math.max(Number(merchant.routeWeight || 100), 1); return cursor < 0; }) || merchants[merchants.length - 1];
  return resolveChannelMerchant(channelId, String(selected.id));
}

export function getChannelPreflight(id: string): Record<string, unknown> | undefined {
  const channel = getChannel(id);
  if (!channel) return undefined;
  const merchants = listChannelMerchants(id);
  const paymentMethod: ChannelPaymentMethod = channel.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
  const readyMerchants = merchants.filter((merchant) => merchant.status === 'ACTIVE' && merchant.bindingStatus === 'ACTIVE' && Boolean(merchant.credentialRef));
  const issues: string[] = [];
  if (channel.status !== "ACTIVE") issues.push("CHANNEL_DISABLED");
  if (!channel.notifyPath.startsWith("/")) issues.push("CALLBACK_PATH_INVALID");
  const readyProductMerchants = merchants.filter((merchant) => merchant.status === 'ACTIVE' && merchant.bindingStatus === 'ACTIVE' && Boolean(merchant.credentialRef) && String(merchant.appStatus || 'DISABLED') === 'ACTIVE');
  if (!readyProductMerchants.length) issues.push(paymentMethod === "JSAPI" ? "WECHAT_JSAPI_MERCHANT_NOT_READY" : "WECHAT_MERCHANT_NOT_READY");
  const platformRows = listChannelPlatformMerchants(id);
  let activePlatformTargets = 0;
  let activeWechatTargets = 0;
  if (platformRows.length) {
    for (const platform of platformRows) {
      if (String(platform.status) !== "ACTIVE" || String(platform.policyStatus || "ACTIVE") !== "ACTIVE") continue;
      const bindings = listPlatformMerchantWechatBindings(String(platform.id)).filter((item) => String(item.status || "ACTIVE") === "ACTIVE" && String(item.merchantStatus || "ACTIVE") === "ACTIVE" && Boolean(item.credentialRef) && Boolean(paymentAppForMerchant(String(item.id), paymentMethod)) && Boolean(db.prepare("SELECT 1 FROM channel_merchant_bindings WHERE channel_id = ? AND merchant_id = ? AND binding_status = 'ACTIVE'").get(id, item.id)));
      if (bindings.length) { activePlatformTargets += 1; activeWechatTargets += bindings.length; }
    }
    if (!activePlatformTargets) issues.push("CODE_MERCHANT_ROUTE_NOT_READY");
  } else {
    activeWechatTargets = readyProductMerchants.length;
  }
  const routingReady = platformRows.length ? activePlatformTargets > 0 : readyProductMerchants.length > 0;
  const ready = issues.length === 0 && routingReady;
  return { channelId: channel.id, status: channel.status, appStatus: channel.appStatus, merchantStatus: readyMerchants.length ? 'ACTIVE' : 'DISABLED', merchantCount: merchants.length, merchants, platformMerchantCount: platformRows.length, activePlatformTargets, activeWechatTargets, issues, routingReady, credentialRefConfigured: readyMerchants.length > 0, credentialsReady: readyMerchants.length > 0, callbackPathConfigured: channel.notifyPath.startsWith("/"), bindingStatus: readyMerchants.length ? 'VERIFIED' : 'MISSING', ready };
}

export interface CreateChannelInput {
  id: string;
  subjectName: string;
  subjectType: string;
  appid: string;
  mchid: string;
  credentialRef: string;
  notifyPath?: string;
  routeWeight?: number;
}

export function createChannel(input: CreateChannelInput): Channel {
  const subjectId = `subject_${input.id}`;
  const appId = `app_${input.id}`;
  const merchantId = `mch_${input.id}`;
  const timestamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO merchant_subjects (id, name, subject_type, created_at) VALUES (?, ?, ?, ?)")
      .run(subjectId, input.subjectName, input.subjectType, timestamp);
    db.prepare("INSERT INTO wechat_apps (id, subject_id, appid) VALUES (?, ?, ?)")
      .run(appId, subjectId, input.appid);
    db.prepare("INSERT INTO wechat_merchants (id, subject_id, mchid, credential_ref) VALUES (?, ?, ?, ?)")
      .run(merchantId, subjectId, input.mchid, input.credentialRef);
    db.prepare("INSERT INTO app_mch_bindings (id, app_id, merchant_id) VALUES (?, ?, ?)")
      .run(`binding_${input.id}`, appId, merchantId);
    db.prepare("INSERT INTO channels (id, subject_id, app_id, merchant_id, notify_path, route_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, subjectId, appId, merchantId, `/webhooks/wechatpay/${input.id}`, input.routeWeight ?? 100, timestamp);
    db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)")
      .run(input.id, merchantId, timestamp);
  });
  tx();
  const channel = getChannel(input.id);
  if (!channel) throw new Error("channel creation failed");
  return channel;
}

export interface CreateSubjectInput { id?: string; name: string; subjectType: string; }
export function createSubject(input: CreateSubjectInput): Record<string, unknown> {
  const id = input.id ?? randomId("subject");
  db.prepare("INSERT INTO merchant_subjects (id, name, subject_type, created_at) VALUES (?, ?, ?, ?)")
    .run(id, input.name, input.subjectType, nowIso());
  return db.prepare("SELECT id, name, subject_type AS subjectType, created_at AS createdAt FROM merchant_subjects WHERE id = ?").get(id) as Record<string, unknown>;
}

db.exec(`CREATE TABLE IF NOT EXISTS merchant_payment_methods (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES wechat_merchants(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  app_id TEXT NOT NULL REFERENCES wechat_apps(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  UNIQUE(merchant_id, method)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS wechat_oauth_states (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  app_id TEXT NOT NULL REFERENCES wechat_apps(id),
  return_url TEXT NOT NULL,
  token_hash TEXT,
  openid_ciphertext TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
)`);
db.prepare("INSERT OR IGNORE INTO merchant_payment_methods (id, merchant_id, method, app_id, created_at) SELECT 'payment_method_native_' || m.id, m.id, 'NATIVE', b.app_id, datetime('now') FROM wechat_merchants m JOIN app_mch_bindings b ON b.merchant_id = m.id WHERE NOT EXISTS (SELECT 1 FROM merchant_payment_methods p WHERE p.merchant_id = m.id)").run();

export interface QrCollectionCodeInput {
  name?: string;
  payload: string;
  ownerId?: string | null;
  channelId?: string | null;
  qrType?: string;
  status?: "ACTIVE" | "PAUSED" | "DISABLED";
  dailyAmountLimit?: number;
  dailyOrderLimit?: number;
  orderWindowSeconds?: number;
  orderWindowLimit?: number;
}

function qrFingerprint(payload: string): string {
  return crypto.createHash("sha256").update(String(payload).trim()).digest("hex");
}

function getQrCodeRow(id: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT q.id, q.name, q.payload, q.owner_id AS ownerId, q.channel_id AS channelId,
      c.id AS channelName, q.qr_type AS qrType, q.status, q.daily_amount_limit AS dailyAmountLimit,
      q.daily_order_limit AS dailyOrderLimit, q.order_window_seconds AS orderWindowSeconds,
      q.order_window_limit AS orderWindowLimit, q.last_used_at AS lastUsedAt, q.created_at AS createdAt, q.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = date('now', '+8 hours')) AS todayOrderCount,
      (SELECT COALESCE(SUM(a.amount), 0) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = date('now', '+8 hours')) AS todayAmount
    FROM qr_collection_codes q LEFT JOIN channels c ON c.id = q.channel_id WHERE q.id = ?`).get(id) as Record<string, unknown> | undefined;
}

export function listQrCollectionCodes(filters: { status?: string; channelId?: string; query?: string } = {}): Array<Record<string, unknown>> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.status) { where.push("q.status = ?"); values.push(filters.status); }
  if (filters.channelId) { where.push("q.channel_id = ?"); values.push(filters.channelId); }
  if (filters.query) { where.push("(q.name LIKE ? OR q.payload LIKE ? OR q.owner_id LIKE ?)"); const q = `%${filters.query}%`; values.push(q, q, q); }
  return db.prepare(`SELECT q.id, q.name, q.payload, q.owner_id AS ownerId, q.channel_id AS channelId,
      c.id AS channelName, q.qr_type AS qrType, q.status, q.daily_amount_limit AS dailyAmountLimit,
      q.daily_order_limit AS dailyOrderLimit, q.order_window_seconds AS orderWindowSeconds,
      q.order_window_limit AS orderWindowLimit, q.last_used_at AS lastUsedAt, q.created_at AS createdAt, q.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = date('now', '+8 hours')) AS todayOrderCount,
      (SELECT COALESCE(SUM(a.amount), 0) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = date('now', '+8 hours')) AS todayAmount
    FROM qr_collection_codes q LEFT JOIN channels c ON c.id = q.channel_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY q.created_at DESC`).all(...values) as Array<Record<string, unknown>>;
}

export function createQrCollectionCode(input: QrCollectionCodeInput): Record<string, unknown> {
  const payload = String(input.payload || "").trim();
  if (!payload) throw new Error("QR_PAYLOAD_REQUIRED");
  const channelId = input.channelId ? String(input.channelId) : null;
  if (channelId && !getChannel(channelId)) throw new Error("CHANNEL_NOT_FOUND");
  const timestamp = nowIso();
  const id = randomId("qrcode");
  const name = String(input.name || `收款码-${id.slice(-6)}`).trim();
  const fingerprint = qrFingerprint(payload);
  db.prepare(`INSERT INTO qr_collection_codes (id, name, payload, code_fingerprint, owner_id, channel_id, qr_type, status, daily_amount_limit, daily_order_limit, order_window_seconds, order_window_limit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, payload, fingerprint, input.ownerId ? String(input.ownerId) : null, channelId,
      String(input.qrType || "STATIC"), input.status || "ACTIVE", Math.max(0, Math.floor(input.dailyAmountLimit || 0)), Math.max(0, Math.floor(input.dailyOrderLimit || 0)), Math.max(0, Math.floor(input.orderWindowSeconds || 0)), Math.max(0, Math.floor(input.orderWindowLimit || 0)), timestamp, timestamp);
  return getQrCodeRow(id) || { id };
}

export function updateQrCollectionCode(id: string, input: Partial<QrCollectionCodeInput>): Record<string, unknown> | undefined {
  const current = db.prepare("SELECT * FROM qr_collection_codes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) return undefined;
  const payload = input.payload == null ? String(current.payload) : String(input.payload).trim();
  if (!payload) throw new Error("QR_PAYLOAD_REQUIRED");
  const channelId = input.channelId === undefined ? (current.channel_id ? String(current.channel_id) : null) : (input.channelId ? String(input.channelId) : null);
  if (channelId && !getChannel(channelId)) throw new Error("CHANNEL_NOT_FOUND");
  db.prepare(`UPDATE qr_collection_codes SET name = ?, payload = ?, code_fingerprint = ?, owner_id = ?, channel_id = ?, qr_type = ?, status = ?, daily_amount_limit = ?, daily_order_limit = ?, order_window_seconds = ?, order_window_limit = ?, updated_at = ? WHERE id = ?`).run(
    String(input.name ?? current.name), payload, qrFingerprint(payload), input.ownerId === undefined ? (current.owner_id || null) : (input.ownerId || null), channelId,
    String(input.qrType ?? current.qr_type), String(input.status ?? current.status), Math.max(0, Math.floor(input.dailyAmountLimit ?? Number(current.daily_amount_limit || 0))), Math.max(0, Math.floor(input.dailyOrderLimit ?? Number(current.daily_order_limit || 0))), Math.max(0, Math.floor(input.orderWindowSeconds ?? Number(current.order_window_seconds || 0))), Math.max(0, Math.floor(input.orderWindowLimit ?? Number(current.order_window_limit || 0))), nowIso(), id);
  return getQrCodeRow(id);
}

export function deleteQrCollectionCode(id: string): boolean {
  try { return db.prepare("DELETE FROM qr_collection_codes WHERE id = ?").run(id).changes > 0; }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("FOREIGN KEY")) throw error;
    return db.prepare("UPDATE qr_collection_codes SET status = 'DISABLED', updated_at = ? WHERE id = ?").run(nowIso(), id).changes > 0;
  }
}

export function assignQrCollectionCodes(ids: string[], channelId: string | null, ownerId?: string | null): Array<Record<string, unknown>> {
  if (channelId && !getChannel(channelId)) throw new Error("CHANNEL_NOT_FOUND");
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  const tx = db.transaction(() => {
    const update = db.prepare("UPDATE qr_collection_codes SET channel_id = ?, owner_id = COALESCE(?, owner_id), updated_at = ? WHERE id = ?");
    for (const id of unique) { if (!db.prepare("SELECT id FROM qr_collection_codes WHERE id = ?").get(id)) throw new Error("QR_CODE_NOT_FOUND"); update.run(channelId, ownerId ?? null, nowIso(), id); }
  });
  tx();
  return listQrCollectionCodes();
}

export function listQrChannelSettings(): Array<Record<string, unknown>> {
  return db.prepare(`SELECT c.id AS channelId, c.id, c.subject_id AS subjectId, s.name AS subjectName, c.status AS channelStatus,
      (SELECT COUNT(*) FROM channel_merchant_bindings cmb WHERE cmb.channel_id = c.id AND cmb.binding_status = 'ACTIVE') AS merchantCount,
      COALESCE(q.enabled, 0) AS enabled, COALESCE(q.route_weight, 100) AS routeWeight,
      COALESCE(q.daily_amount_limit, 0) AS dailyAmountLimit, COALESCE(q.daily_order_limit, 0) AS dailyOrderLimit,
      COALESCE(q.order_window_seconds, 0) AS orderWindowSeconds, COALESCE(q.order_window_limit, 0) AS orderWindowLimit,
      COALESCE(q.auto_pause_enabled, 1) AS autoPauseEnabled, COALESCE(q.failure_rate_threshold, 0) AS failureRateThreshold,
      COALESCE(q.min_orders_for_check, 5) AS minOrdersForCheck, COALESCE(q.timeout_minutes, 15) AS timeoutMinutes,
      COALESCE(q.alert_enabled, 1) AS alertEnabled,
      (SELECT COUNT(*) FROM qr_collection_codes x WHERE x.channel_id = c.id AND x.status = 'ACTIVE') AS qrCodeCount
    FROM channels c JOIN merchant_subjects s ON s.id = c.subject_id LEFT JOIN qr_channel_settings q ON q.channel_id = c.id ORDER BY c.created_at DESC`).all() as Array<Record<string, unknown>>;
}

export function updateQrChannelSetting(channelId: string, input: { enabled?: boolean; routeWeight?: number; dailyAmountLimit?: number; dailyOrderLimit?: number; orderWindowSeconds?: number; orderWindowLimit?: number; autoPauseEnabled?: boolean; failureRateThreshold?: number; minOrdersForCheck?: number; timeoutMinutes?: number; alertEnabled?: boolean }): Record<string, unknown> | undefined {
  if (!getChannel(channelId)) return undefined;
  const current = db.prepare("SELECT * FROM qr_channel_settings WHERE channel_id = ?").get(channelId) as Record<string, unknown> | undefined;
  const values = {
    enabled: input.enabled === undefined ? Number(current?.enabled || 0) : (input.enabled ? 1 : 0),
    routeWeight: Math.max(1, Math.floor(input.routeWeight ?? Number(current?.route_weight || 100))),
    dailyAmountLimit: Math.max(0, Math.floor(input.dailyAmountLimit ?? Number(current?.daily_amount_limit || 0))),
    dailyOrderLimit: Math.max(0, Math.floor(input.dailyOrderLimit ?? Number(current?.daily_order_limit || 0))),
    orderWindowSeconds: Math.max(0, Math.floor(input.orderWindowSeconds ?? Number(current?.order_window_seconds || 0))),
    orderWindowLimit: Math.max(0, Math.floor(input.orderWindowLimit ?? Number(current?.order_window_limit || 0))),
    autoPauseEnabled: input.autoPauseEnabled === undefined ? Number(current?.auto_pause_enabled ?? 1) : (input.autoPauseEnabled ? 1 : 0),
    failureRateThreshold: Math.max(0, Math.min(100, Math.floor(input.failureRateThreshold ?? Number(current?.failure_rate_threshold || 0)))),
    minOrdersForCheck: Math.max(1, Math.min(1000000, Math.floor(input.minOrdersForCheck ?? Number(current?.min_orders_for_check || 5)))),
    timeoutMinutes: Math.max(1, Math.min(1440, Math.floor(input.timeoutMinutes ?? Number(current?.timeout_minutes || 15)))),
    alertEnabled: input.alertEnabled === undefined ? Number(current?.alert_enabled ?? 1) : (input.alertEnabled ? 1 : 0)
  };
  db.prepare(`INSERT INTO qr_channel_settings (channel_id, enabled, route_weight, daily_amount_limit, daily_order_limit, order_window_seconds, order_window_limit, auto_pause_enabled, failure_rate_threshold, min_orders_for_check, timeout_minutes, alert_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET enabled=excluded.enabled, route_weight=excluded.route_weight, daily_amount_limit=excluded.daily_amount_limit, daily_order_limit=excluded.daily_order_limit, order_window_seconds=excluded.order_window_seconds, order_window_limit=excluded.order_window_limit, auto_pause_enabled=excluded.auto_pause_enabled, failure_rate_threshold=excluded.failure_rate_threshold, min_orders_for_check=excluded.min_orders_for_check, timeout_minutes=excluded.timeout_minutes, alert_enabled=excluded.alert_enabled, updated_at=excluded.updated_at`).run(channelId, values.enabled, values.routeWeight, values.dailyAmountLimit, values.dailyOrderLimit, values.orderWindowSeconds, values.orderWindowLimit, values.autoPauseEnabled, values.failureRateThreshold, values.minOrdersForCheck, values.timeoutMinutes, values.alertEnabled, nowIso());
  return listQrChannelSettings().find((item) => String(item.channelId) === channelId);
}

export function reserveQrCodeForOrder(channelId: string, orderId: string, amount: number): Record<string, unknown> | undefined {
  const setting = db.prepare("SELECT * FROM qr_channel_settings WHERE channel_id = ? AND enabled = 1").get(channelId) as Record<string, unknown> | undefined;
  if (!setting) return undefined;
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowSeconds = Number(setting.order_window_seconds || 0); const windowLimit = Number(setting.order_window_limit || 0);
  const channelUsage = db.prepare(`SELECT COUNT(*) AS orderCount, COALESCE(SUM(a.amount), 0) AS amount FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE o.channel_id = ? AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = ?`).get(channelId, day) as { orderCount: number; amount: number };
  if (Number(setting.daily_order_limit || 0) > 0 && Number(channelUsage.orderCount) >= Number(setting.daily_order_limit)) return undefined;
  if (Number(setting.daily_amount_limit || 0) > 0 && Number(channelUsage.amount) + amount > Number(setting.daily_amount_limit)) return undefined;
  if (windowSeconds > 0 && windowLimit > 0) {
    const recent = db.prepare(`SELECT COUNT(*) AS count FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE o.channel_id = ? AND o.status NOT IN ('FAILED', 'CLOSED') AND a.created_at >= datetime('now', ?)`).get(channelId, `-${windowSeconds} seconds`) as { count: number };
    if (Number(recent.count) >= windowLimit) return undefined;
  }
  const candidates = db.prepare(`SELECT q.* FROM qr_collection_codes q
    WHERE q.channel_id = ? AND q.status = 'ACTIVE'
      AND (q.daily_order_limit = 0 OR (SELECT COUNT(*) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = ?) < q.daily_order_limit)
      AND (q.daily_amount_limit = 0 OR (SELECT COALESCE(SUM(a.amount), 0) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = ?) + ? <= q.daily_amount_limit)
      AND (? = 0 OR ? = 0 OR (SELECT COUNT(*) FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id WHERE a.qr_code_id = q.id AND o.status NOT IN ('FAILED', 'CLOSED') AND a.created_at >= datetime('now', ?)) < ?)
    ORDER BY COALESCE(q.last_used_at, '') ASC, q.created_at ASC LIMIT 1`).all(channelId, day, day, Math.max(0, Math.floor(amount)), windowSeconds, windowLimit, `-${Math.max(0, windowSeconds)} seconds`, windowLimit) as Array<Record<string, unknown>>;
  const candidate = candidates[0]; if (!candidate) return undefined;
  const timestamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO qr_code_allocations (order_id, qr_code_id, amount, created_at) VALUES (?, ?, ?, ?)").run(orderId, candidate.id, Math.floor(amount), timestamp);
    db.prepare("UPDATE qr_collection_codes SET last_used_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, candidate.id);
  });
  try { tx(); } catch { return undefined; }
  return { id: candidate.id, name: candidate.name, payload: candidate.payload, channelId: candidate.channel_id, qrType: candidate.qr_type };
}

export function isQrChannelEnabled(channelId: string): boolean {
  const row = db.prepare("SELECT enabled FROM qr_channel_settings WHERE channel_id = ?").get(channelId) as { enabled?: number } | undefined;
  return Number(row?.enabled || 0) === 1;
}

export function getQrCodeUsage(id: string): Record<string, unknown> {
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db.prepare(`SELECT COUNT(*) AS todayOrderCount, COALESCE(SUM(a.amount), 0) AS todayAmount,
      MAX(a.created_at) AS lastUsedAt FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id
      WHERE a.qr_code_id = ? AND o.status NOT IN ('FAILED', 'CLOSED') AND date(a.created_at, '+8 hours') = ?`).get(id, day) as Record<string, unknown>;
}

export function listQrMonitoring(): Array<Record<string, unknown>> {
  return db.prepare(`SELECT q.id AS qrCodeId, q.name, q.owner_id AS ownerId, q.channel_id AS channelId, q.status,
      q.last_used_at AS lastUsedAt, COALESCE(c.id, q.channel_id, '未分配') AS channelName,
      SUM(CASE WHEN a.created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS orderCount24h,
      SUM(CASE WHEN a.created_at >= datetime('now', '-24 hours') AND o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount24h,
      SUM(CASE WHEN a.created_at >= datetime('now', '-24 hours') AND o.status IN ('FAILED','CLOSED') THEN 1 ELSE 0 END) AS failedCount24h,
      SUM(CASE WHEN a.created_at >= datetime('now', '-24 hours') AND o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN') AND a.created_at < datetime('now', '-' || COALESCE(s.timeout_minutes, 15) || ' minutes') THEN 1 ELSE 0 END) AS timeoutCount24h,
      COALESCE(SUM(CASE WHEN a.created_at >= datetime('now', '-24 hours') THEN a.amount ELSE 0 END), 0) AS amount24h,
      COALESCE(s.failure_rate_threshold, 0) AS failureRateThreshold, COALESCE(s.min_orders_for_check, 5) AS minOrdersForCheck,
      COALESCE(s.auto_pause_enabled, 1) AS autoPauseEnabled, COALESCE(s.alert_enabled, 1) AS alertEnabled
    FROM qr_collection_codes q LEFT JOIN qr_code_allocations a ON a.qr_code_id = q.id
      LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN channels c ON c.id = q.channel_id
      LEFT JOIN qr_channel_settings s ON s.channel_id = q.channel_id
    GROUP BY q.id ORDER BY CASE WHEN q.status = 'ACTIVE' THEN 0 ELSE 1 END, q.updated_at DESC`).all().map((row: any) => {
      const orders = Number(row.orderCount24h || 0); const failed = Number(row.failedCount24h || 0); const success = Number(row.successCount24h || 0);
      const failureRate = orders ? Math.round(failed * 10000 / orders) / 100 : 0;
      const alert = Number(row.status === 'PAUSED' || row.timeoutCount24h || (Number(row.failureRateThreshold) > 0 && orders >= Number(row.minOrdersForCheck) && failureRate >= Number(row.failureRateThreshold)));
      return { ...row, orderCount24h: orders, successCount24h: success, failedCount24h: failed, timeoutCount24h: Number(row.timeoutCount24h || 0), amount24h: Number(row.amount24h || 0), failureRate, alert };
    }) as Array<Record<string, unknown>>;
}

export function runQrMonitorPass(channelIds?: string[]): { checked: number; paused: number; alerts: number } {
  const allowed = channelIds ? new Set(channelIds.map(String)) : undefined;
  const rows = listQrMonitoring().filter((row) => !allowed || (row.channelId && allowed.has(String(row.channelId)))); let paused = 0; let alerts = 0;
  const pause = db.prepare("UPDATE qr_collection_codes SET status = 'PAUSED', updated_at = ? WHERE id = ? AND status = 'ACTIVE'");
  const tx = db.transaction(() => { for (const row of rows) {
    const orders = Number(row.orderCount24h || 0); const threshold = Number(row.failureRateThreshold || 0);
    const shouldPause = Number(row.autoPauseEnabled || 0) === 1 && orders >= Number(row.minOrdersForCheck || 5) && threshold > 0 && Number(row.failureRate || 0) >= threshold;
    if (shouldPause && pause.run(nowIso(), String(row.qrCodeId)).changes > 0) paused += 1;
    if (Number(row.alert) === 1) alerts += 1;
  } }); tx();
  return { checked: rows.length, paused, alerts };
}

export function listQrOrders(limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db.prepare(`SELECT o.id, o.platform_order_no AS platformOrderNo, o.amount, o.status, o.created_at AS createdAt,
      o.expire_at AS expireAt, o.paid_at AS paidAt, a.qr_code_id AS qrCodeId, q.name AS qrCodeName,
      o.channel_id AS channelId, o.transaction_id AS transactionId
    FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id JOIN qr_collection_codes q ON q.id = a.qr_code_id
    ORDER BY o.created_at DESC LIMIT ?`).all(safeLimit) as Array<Record<string, unknown>>;
}

export interface CreateAppInput { id?: string; subjectId: string; appid: string; appType?: string; oauthDomain?: string; jsapiPath?: string; verifyFile?: string; verifyToken?: string; }
export function createApp(input: CreateAppInput): Record<string, unknown> {
  const id = input.id ?? randomId("app");
  if (!db.prepare("SELECT id FROM merchant_subjects WHERE id = ?").get(input.subjectId)) throw new Error("SUBJECT_NOT_FOUND");
  const existing = db.prepare("SELECT id, subject_id AS subjectId FROM wechat_apps WHERE appid = ?").get(input.appid) as { id: string; subjectId: string } | undefined;
  if (existing) throw new Error(existing.subjectId === input.subjectId ? "APPID_ALREADY_EXISTS" : "APPID_ALREADY_BOUND_TO_OTHER_SUBJECT");
  db.prepare("INSERT INTO wechat_apps (id, subject_id, appid, app_type, oauth_domain, jsapi_path, verify_file, verify_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.subjectId, input.appid, input.appType ?? "SERVICE_ACCOUNT", input.oauthDomain ?? "", input.jsapiPath ?? "", input.verifyFile ?? "", input.verifyToken ?? "");
  return db.prepare("SELECT a.id, a.subject_id AS subjectId, a.appid, a.app_type AS appType, a.oauth_domain AS oauthDomain, a.jsapi_path AS jsapiPath, a.verify_file AS verifyFile, a.status FROM wechat_apps a WHERE a.id = ?").get(id) as Record<string, unknown>;
}

export function getWechatApp(id: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT a.id, a.subject_id AS subjectId, a.appid, a.app_type AS appType, a.oauth_domain AS oauthDomain, a.jsapi_path AS jsapiPath, a.verify_file AS verifyFile, a.verify_token AS verifyToken, a.status FROM wechat_apps a WHERE a.id = ?").get(id) as Record<string, unknown> | undefined;
}

export function getMerchantPaymentMethod(merchantId: string, method: "NATIVE" | "JSAPI"): Record<string, unknown> | undefined {
  return db.prepare("SELECT p.merchant_id AS merchantId, p.method, p.app_id AS appId, a.appid, a.app_type AS appType, a.oauth_domain AS oauthDomain, a.jsapi_path AS jsapiPath, p.status, a.status AS appStatus FROM merchant_payment_methods p JOIN wechat_apps a ON a.id = p.app_id WHERE p.merchant_id = ? AND p.method = ?").get(merchantId, method) as Record<string, unknown> | undefined;
}

function oauthTokenHash(token: string): string { return crypto.createHash("sha256").update(token, "utf8").digest("hex"); }

export function createWechatOAuthState(input: { appId: string; returnUrl: string; expiresAt: string; contextId?: string; contextType?: string }): string {
  const state = randomId("wxstate");
  db.prepare("INSERT INTO wechat_oauth_states (id, state, app_id, return_url, context_id, context_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomId("oauth"), state, input.appId, input.returnUrl, input.contextId ?? null, input.contextType ?? null, nowIso(), input.expiresAt);
  return state;
}

export function getWechatOAuthState(state: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT state, app_id AS appId, return_url AS returnUrl, context_id AS contextId, context_type AS contextType, token_hash AS tokenHash, openid_ciphertext AS openidCiphertext, created_at AS createdAt, expires_at AS expiresAt, consumed_at AS consumedAt FROM wechat_oauth_states WHERE state = ?").get(state) as Record<string, unknown> | undefined;
}

export function completeWechatOAuthState(state: string, token: string, openid: string): Record<string, unknown> | undefined {
  const row = getWechatOAuthState(state);
  if (!row || row.tokenHash || row.consumedAt || new Date(String(row.expiresAt)).getTime() <= Date.now()) return undefined;
  const changed = db.prepare("UPDATE wechat_oauth_states SET token_hash = ?, openid_ciphertext = ? WHERE state = ? AND token_hash IS NULL AND consumed_at IS NULL").run(oauthTokenHash(token), encryptSecret(openid), state).changes;
  if (!changed) return undefined;
  return getWechatOAuthState(state);
}

export function consumeWechatOAuthToken(token: string): { appId: string; openid: string; contextId?: string; contextType?: string } | undefined {
  const row = db.prepare("SELECT state, app_id AS appId, context_id AS contextId, context_type AS contextType, openid_ciphertext AS openidCiphertext, expires_at AS expiresAt, consumed_at AS consumedAt FROM wechat_oauth_states WHERE token_hash = ?").get(oauthTokenHash(token)) as { state: string; appId: string; contextId?: string; contextType?: string; openidCiphertext: string; expiresAt: string; consumedAt?: string } | undefined;
  if (!row || !row.openidCiphertext || row.consumedAt || new Date(row.expiresAt).getTime() <= Date.now()) return undefined;
  const changed = db.prepare("UPDATE wechat_oauth_states SET consumed_at = ? WHERE state = ? AND consumed_at IS NULL").run(nowIso(), row.state).changes;
  if (!changed) return undefined;
  return { appId: row.appId, openid: decryptSecret(row.openidCiphertext), contextId: row.contextId, contextType: row.contextType };
}

export function createPublicPaymentEntry(input: { orderId: string; tokenHash: string; token?: string; pagePath: string; qrDataUrl?: string | null; expiresAt: string }): PublicPaymentEntry {
  const id = randomId("pentry");
  const now = nowIso();
  db.prepare(`INSERT INTO public_payment_entries
    (id, order_id, token_hash, token_ciphertext, page_path, qr_data_url, entry_mode, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'PUBLIC_ACCOUNT_ARTICLE', 'ACTIVE', ?, ?, ?)`)
    .run(id, input.orderId, input.tokenHash, input.token ? encryptSecret(input.token) : null, input.pagePath, input.qrDataUrl ?? null, input.expiresAt, now, now);
  return getPublicPaymentEntryById(id)!;
}

export function getPublicPaymentEntryToken(orderId: string): string | undefined {
  const row = db.prepare("SELECT token_ciphertext AS tokenCiphertext FROM public_payment_entries WHERE order_id = ?").get(orderId) as { tokenCiphertext?: string } | undefined;
  if (!row?.tokenCiphertext) return undefined;
  try { return decryptSecret(row.tokenCiphertext); } catch { return undefined; }
}

export function getPublicPaymentEntryById(id: string): PublicPaymentEntry | undefined {
  const row = db.prepare(`SELECT id, order_id AS orderId, token_hash AS tokenHash, page_path AS pagePath,
      qr_data_url AS qrDataUrl, entry_mode AS entryMode, status, expires_at AS expiresAt,
      used_at AS usedAt, revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
    FROM public_payment_entries WHERE id = ?`).get(id) as PublicPaymentEntry | undefined;
  return row;
}

export function getPublicPaymentEntryByTokenHash(tokenHash: string): PublicPaymentEntry | undefined {
  const row = db.prepare(`SELECT id, order_id AS orderId, token_hash AS tokenHash, page_path AS pagePath,
      qr_data_url AS qrDataUrl, entry_mode AS entryMode, status, expires_at AS expiresAt,
      used_at AS usedAt, revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
    FROM public_payment_entries WHERE token_hash = ?`).get(tokenHash) as PublicPaymentEntry | undefined;
  return row;
}

export function getPublicPaymentEntryByOrder(orderId: string): PublicPaymentEntry | undefined {
  const row = db.prepare(`SELECT id, order_id AS orderId, token_hash AS tokenHash, page_path AS pagePath,
      qr_data_url AS qrDataUrl, entry_mode AS entryMode, status, expires_at AS expiresAt,
      used_at AS usedAt, revoked_at AS revokedAt, created_at AS createdAt, updated_at AS updatedAt
    FROM public_payment_entries WHERE order_id = ?`).get(orderId) as PublicPaymentEntry | undefined;
  return row;
}

export function updatePublicPaymentEntry(id: string, values: { status?: PublicPaymentEntryStatus; qrDataUrl?: string | null; usedAt?: string | null; revokedAt?: string | null }): PublicPaymentEntry | undefined {
  const current = getPublicPaymentEntryById(id);
  if (!current) return undefined;
  db.prepare(`UPDATE public_payment_entries SET status = ?, qr_data_url = ?, used_at = ?, revoked_at = ?, updated_at = ? WHERE id = ?`)
    .run(values.status ?? current.status, values.qrDataUrl === undefined ? current.qrDataUrl ?? null : values.qrDataUrl, values.usedAt === undefined ? current.usedAt ?? null : values.usedAt, values.revokedAt === undefined ? current.revokedAt ?? null : values.revokedAt, nowIso(), id);
  return getPublicPaymentEntryById(id);
}

export function expirePublicPaymentEntries(now = new Date().toISOString()): number {
  const rows = db.prepare("SELECT id, order_id AS orderId FROM public_payment_entries WHERE status = 'ACTIVE' AND expires_at <= ?").all(now) as Array<{ id: string; orderId: string }>;
  let count = 0;
  for (const row of rows) {
    updatePublicPaymentEntry(row.id, { status: "EXPIRED" });
    const order = getOrder(row.orderId);
    if (order && ["CREATED", "ROUTED", "QR_CREATED", "PAYING"].includes(String(order.status))) {
      try { updateOrderPayment(order.id, { status: "CLOSED" }); } catch { /* callback may have won the race */ }
    }
    count += 1;
  }
  return count;
}

export interface WechatArticleDraftRecord {
  id: string; orderId: string; entryId: string; appId: string; draftMediaId?: string | null; previewUrl?: string | null;
  qrMediaUrl?: string | null; coverMediaId?: string | null; status: string; wechatErrcode?: string | null; wechatErrmsg?: string | null;
  expiresAt?: string | null; createdAt: string; updatedAt: string;
}

export function upsertWechatArticleDraft(input: Omit<WechatArticleDraftRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): WechatArticleDraftRecord {
  const existing = db.prepare("SELECT id FROM wechat_article_drafts WHERE order_id = ?").get(input.orderId) as { id: string } | undefined;
  const id = existing?.id ?? input.id ?? randomId("draft");
  const now = nowIso();
  db.prepare(`INSERT INTO wechat_article_drafts
    (id, order_id, entry_id, app_id, draft_media_id, preview_url, qr_media_url, cover_media_id, status, wechat_errcode, wechat_errmsg, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET entry_id=excluded.entry_id, app_id=excluded.app_id, draft_media_id=excluded.draft_media_id,
      preview_url=excluded.preview_url, qr_media_url=excluded.qr_media_url, cover_media_id=excluded.cover_media_id,
      status=excluded.status, wechat_errcode=excluded.wechat_errcode, wechat_errmsg=excluded.wechat_errmsg,
      expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
    .run(id, input.orderId, input.entryId, input.appId, input.draftMediaId ?? null, input.previewUrl ?? null, input.qrMediaUrl ?? null, input.coverMediaId ?? null, input.status, input.wechatErrcode ?? null, input.wechatErrmsg ?? null, input.expiresAt ?? null, existing ? now : now, now);
  return getWechatArticleDraftByOrder(input.orderId)!;
}

export function getWechatArticleDraftByOrder(orderId: string): WechatArticleDraftRecord | undefined {
  return db.prepare(`SELECT id, order_id AS orderId, entry_id AS entryId, app_id AS appId, draft_media_id AS draftMediaId,
    preview_url AS previewUrl, qr_media_url AS qrMediaUrl, cover_media_id AS coverMediaId, status,
    wechat_errcode AS wechatErrcode, wechat_errmsg AS wechatErrmsg, expires_at AS expiresAt,
    created_at AS createdAt, updated_at AS updatedAt FROM wechat_article_drafts WHERE order_id = ?`).get(orderId) as WechatArticleDraftRecord | undefined;
}

export function recordPublicPaymentEvent(input: { orderId?: string | null; entryId?: string | null; eventType: string; durationMs?: number | null; errorCode?: string | null; detail?: Record<string, unknown> }): void {
  db.prepare(`INSERT INTO public_payment_events
    (id, order_id, entry_id, event_type, duration_ms, error_code, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomId("ppevent"), input.orderId ?? null, input.entryId ?? null, input.eventType, input.durationMs ?? null, input.errorCode ?? null, JSON.stringify(input.detail ?? {}), nowIso());
}

export interface WechatHandoffTicket {
  id: string;
  orderId: string;
  entryId: string;
  ticketHash: string;
  previewUrl: string;
  status: "ACTIVE" | "USED" | "EXPIRED" | "FAILED";
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createWechatHandoffTicket(input: { orderId: string; entryId: string; ticketHash: string; previewUrl: string; expiresAt: string }): WechatHandoffTicket {
  const id = randomId("whandoff");
  const now = nowIso();
  db.prepare(`INSERT INTO wechat_handoff_tickets
    (id, order_id, entry_id, ticket_hash, preview_url, status, expires_at, used_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`)
    .run(id, input.orderId, input.entryId, input.ticketHash, input.previewUrl, input.expiresAt, now, now);
  return getWechatHandoffTicketById(id)!;
}

export function getWechatHandoffTicketById(id: string): WechatHandoffTicket | undefined {
  return db.prepare(`SELECT id, order_id AS orderId, entry_id AS entryId, ticket_hash AS ticketHash,
      preview_url AS previewUrl, status, expires_at AS expiresAt, used_at AS usedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM wechat_handoff_tickets WHERE id = ?`).get(id) as WechatHandoffTicket | undefined;
}

export function getWechatHandoffTicketByHash(ticketHash: string): WechatHandoffTicket | undefined {
  return db.prepare(`SELECT id, order_id AS orderId, entry_id AS entryId, ticket_hash AS ticketHash,
      preview_url AS previewUrl, status, expires_at AS expiresAt, used_at AS usedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM wechat_handoff_tickets WHERE ticket_hash = ?`).get(ticketHash) as WechatHandoffTicket | undefined;
}

export function consumeWechatHandoffTicket(ticketHash: string, now = nowIso()): WechatHandoffTicket | undefined {
  const usedAt = nowIso();
  const result = db.prepare(`UPDATE wechat_handoff_tickets
    SET status = 'USED', used_at = ?, updated_at = ?
    WHERE ticket_hash = ? AND status = 'ACTIVE' AND expires_at > ?`).run(usedAt, usedAt, ticketHash, now);
  if (result.changes !== 1) return undefined;
  return db.prepare(`SELECT id, order_id AS orderId, entry_id AS entryId, ticket_hash AS ticketHash,
      preview_url AS previewUrl, status, expires_at AS expiresAt, used_at AS usedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM wechat_handoff_tickets WHERE ticket_hash = ?`).get(ticketHash) as WechatHandoffTicket | undefined;
}

export function getPublicPaymentMonitoring(windowHours = 24): Record<string, unknown> {
  const hours = Math.max(1, Math.min(168, Math.floor(windowHours || 24)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const draft = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN preview_url IS NOT NULL AND preview_url <> '' THEN 1 ELSE 0 END) AS previewReady
    FROM wechat_article_drafts WHERE created_at >= ?`).get(since) as Record<string, unknown>;
  const oauth = db.prepare(`SELECT COUNT(*) AS started,
      SUM(CASE WHEN token_hash IS NOT NULL THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN token_hash IS NULL AND expires_at <= ? THEN 1 ELSE 0 END) AS expired
    FROM wechat_oauth_states WHERE context_type = 'PUBLIC_PAYMENT_ENTRY' AND created_at >= ?`).get(new Date().toISOString(), since) as Record<string, unknown>;
  const orders = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status IN ('FAILED', 'UNKNOWN') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('CREATED', 'ROUTED', 'QR_CREATED', 'PAYING') THEN 1 ELSE 0 END) AS pending,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS successAmount
    FROM orders WHERE payment_method = 'JSAPI' AND created_at >= ?`).get(since) as Record<string, unknown>;
  const callbacks = db.prepare(`SELECT COUNT(*) AS total
    FROM webhook_events e JOIN orders o ON o.channel_id = e.channel_id AND o.channel_out_trade_no = e.out_trade_no
    WHERE o.payment_method = 'JSAPI' AND e.created_at >= ?`).get(since) as Record<string, unknown>;
  const events = db.prepare(`SELECT event_type AS eventType, COUNT(*) AS count, AVG(duration_ms) AS avgDurationMs
    FROM public_payment_events WHERE created_at >= ? GROUP BY event_type ORDER BY count DESC`).all(since) as Array<Record<string, unknown>>;
  const recent = db.prepare(`SELECT e.id, e.order_id AS orderId, e.entry_id AS entryId, e.event_type AS eventType,
      e.duration_ms AS durationMs, e.error_code AS errorCode, e.detail, e.created_at AS createdAt,
      o.platform_order_no AS platformOrderNo, o.amount, o.status AS orderStatus
    FROM public_payment_events e LEFT JOIN orders o ON o.id = e.order_id
    WHERE e.created_at >= ? ORDER BY e.created_at DESC LIMIT 100`).all(since) as Array<Record<string, unknown>>;
  const total = Number(orders.total || 0);
  const success = Number(orders.success || 0);
  const eventCount = (eventType: string): number => Number(events.find((item) => String(item.eventType) === eventType)?.count || 0);
  return {
    windowHours: hours,
    since,
    summary: {
      articleTotal: Number(draft.total || 0), articleReady: Number(draft.ready || 0), articleFailed: Number(draft.failed || 0),
      previewReady: Number(draft.previewReady || 0),
      oauthStarted: Number(oauth.started || 0), oauthCompleted: Number(oauth.completed || 0), oauthExpired: Number(oauth.expired || 0),
      jsapiOrders: total, jsapiSuccess: success, jsapiFailed: Number(orders.failed || 0), jsapiPending: Number(orders.pending || 0),
      jsapiSuccessRate: total ? Math.round(success * 10000 / total) / 100 : 0,
      jsapiSuccessAmount: Number(orders.successAmount || 0),
      jsapiCallbacks: Number(callbacks.total || 0),
      fallbackCount: eventCount('FALLBACK_JSAPI'),
      wakeAttempted: eventCount('WAKE_ATTEMPTED'),
      wakeAppSwitched: eventCount('WAKE_APP_SWITCHED'),
      handoffTickets: eventCount('HANDOFF_TICKET_CREATED'),
      bridgeOpened: eventCount('HANDOFF_BRIDGE_OPENED'),
      previewRedirected: eventCount('HANDOFF_PREVIEW_REDIRECTED'),
      handoffFailed: eventCount('HANDOFF_TICKET_FAILED') + eventCount('HANDOFF_BRIDGE_FAILED'),
      gatewayFallback: eventCount('WAKE_GATEWAY_FALLBACK'),
      wakeWaitTimeout: eventCount('WAKE_WAIT_TIMEOUT'),
      handoffUnavailable: eventCount('WAKE_HANDOFF_UNAVAILABLE')
    },
    events: events.map((item) => ({ ...item, count: Number(item.count || 0), avgDurationMs: Math.round(Number(item.avgDurationMs || 0)) })),
    recent
  };
}

export function listPublicPaymentEntries(input: { status?: string; limit?: number } = {}): Array<Record<string, unknown>> {
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const params: unknown[] = [];
  const where = input.status ? "WHERE e.status = ?" : "";
  if (input.status) params.push(input.status);
  params.push(limit);
  return db.prepare(`SELECT e.id, e.order_id AS orderId, e.entry_mode AS entryMode, e.status, e.expires_at AS expiresAt,
      e.created_at AS createdAt, e.updated_at AS updatedAt, o.platform_order_no AS platformOrderNo, o.merchant_id AS merchantId, o.channel_id AS channelId, o.amount,
      o.payment_method AS paymentMethod, d.status AS draftStatus, d.draft_media_id AS draftMediaId,
      d.preview_url AS previewUrl, d.wechat_errmsg AS draftError
    FROM public_payment_entries e JOIN orders o ON o.id = e.order_id
    LEFT JOIN wechat_article_drafts d ON d.entry_id = e.id ${where}
    ORDER BY e.created_at DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>;
}

export function updateApp(id: string, input: { oauthDomain?: string; jsapiPath?: string; verifyFile?: string; verifyToken?: string }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM wechat_apps WHERE id = ?").get(id)) return undefined;
  db.prepare("UPDATE wechat_apps SET oauth_domain = ?, jsapi_path = ?, verify_file = ?, verify_token = ? WHERE id = ?")
    .run(input.oauthDomain ?? "", input.jsapiPath ?? "", input.verifyFile ?? "", input.verifyToken ?? "", id);
  return listApps().find((item) => String(item.id) === id);
}

/**
 * Find the stored WeChat web-auth verification file by its public filename
 * (e.g. "MP_verify_abc123.txt"). Returns the active app that owns it and the
 * token content WeChat expects at the domain root.
 */
export function getAppVerifyFile(fileName: string): { appId: string; appid: string; token: string } | undefined {
  const row = db.prepare("SELECT a.id AS appId, a.appid, a.verify_token AS token FROM wechat_apps a WHERE a.verify_file = ? AND a.status = 'ACTIVE' LIMIT 1").get(fileName) as { appId: string; appid: string; token: string } | undefined;
  if (!row || !row.token) return undefined;
  return row;
}

export interface CreateMerchantInput { id?: string; subjectId: string; appId?: string; appIds?: string[]; paymentMethods?: Array<"NATIVE" | "JSAPI">; nativeAppId?: string; jsapiAppId?: string; mchid: string; credentialRef: string; dailyAmountLimit?: number; complaintCount?: number; orderWindowSeconds?: number; orderWindowLimit?: number; dailyOrderLimit?: number; dailySuccessLimit?: number; }
export function createMerchant(input: CreateMerchantInput): Record<string, unknown> {
  const id = input.id ?? randomId("mch");
  if (!db.prepare("SELECT id FROM merchant_subjects WHERE id = ?").get(input.subjectId)) throw new Error("SUBJECT_NOT_FOUND");
  const paymentMethods = input.paymentMethods?.length ? [...new Set(input.paymentMethods)] : (input.appId || input.appIds?.length ? ["NATIVE"] : []);
  const nativeAppId = input.nativeAppId || input.appId || (paymentMethods.includes("NATIVE") ? input.appIds?.[0] : undefined);
  const jsapiAppId = input.jsapiAppId || (paymentMethods.includes("JSAPI") ? input.appId || input.appIds?.[0] : undefined);
  if (paymentMethods.includes("NATIVE") && !nativeAppId) throw new Error("NATIVE_APP_REQUIRED");
  if (paymentMethods.includes("JSAPI") && !jsapiAppId) throw new Error("JSAPI_APP_REQUIRED");
  const appIds = [...new Set([nativeAppId, jsapiAppId, ...(input.appIds || [])].filter(Boolean) as string[])];
  for (const appId of appIds) {
    const app = db.prepare("SELECT id, subject_id AS subjectId, app_type AS appType, status FROM wechat_apps WHERE id = ?").get(appId) as { id: string; subjectId: string; appType: string; status: string } | undefined;
    if (!app) throw new Error("APP_NOT_FOUND");
    if (app.subjectId !== input.subjectId) throw new Error("APP_SUBJECT_MISMATCH");
    if (app.status !== "ACTIVE") throw new Error("APP_DISABLED");
    if (paymentMethods.includes("JSAPI") && appId === jsapiAppId && app.appType !== "SERVICE_ACCOUNT") throw new Error("JSAPI_REQUIRES_SERVICE_ACCOUNT");
  }
  db.prepare("INSERT INTO wechat_merchants (id, subject_id, mchid, credential_ref, daily_amount_limit, complaint_count, risk_enabled, order_window_seconds, order_window_limit, daily_order_limit, daily_success_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.subjectId, input.mchid, input.credentialRef, Math.max(0, Math.floor(input.dailyAmountLimit ?? 0)), Math.max(0, Math.floor(input.complaintCount ?? 0)), 1, Math.max(0, Math.floor(input.orderWindowSeconds ?? 0)), Math.max(0, Math.floor(input.orderWindowLimit ?? 0)), Math.max(0, Math.floor(input.dailyOrderLimit ?? 0)), Math.max(0, Math.floor(input.dailySuccessLimit ?? 0)));
  const now = nowIso();
  for (const appId of appIds) db.prepare("INSERT OR IGNORE INTO app_mch_bindings (id, app_id, merchant_id, binding_status) VALUES (?, ?, ?, 'VERIFIED')").run(randomId("binding"), appId, id);
  if (nativeAppId && paymentMethods.includes("NATIVE")) db.prepare("INSERT OR IGNORE INTO merchant_payment_methods (id, merchant_id, method, app_id, created_at) VALUES (?, ?, 'NATIVE', ?, ?)").run(randomId("pm"), id, nativeAppId, now);
  if (jsapiAppId && paymentMethods.includes("JSAPI")) db.prepare("INSERT OR IGNORE INTO merchant_payment_methods (id, merchant_id, method, app_id, created_at) VALUES (?, ?, 'JSAPI', ?, ?)").run(randomId("pm"), id, jsapiAppId, now);
  return db.prepare("SELECT m.id, m.subject_id AS subjectId, m.mchid, m.credential_ref AS credentialRef, m.status, m.daily_amount_limit AS dailyAmountLimit, m.complaint_count AS complaintCount, m.risk_enabled AS riskEnabled, m.order_window_seconds AS orderWindowSeconds, m.order_window_limit AS orderWindowLimit, m.daily_order_limit AS dailyOrderLimit, m.daily_success_limit AS dailySuccessLimit FROM wechat_merchants m WHERE m.id = ?").get(id) as Record<string, unknown>;
}
export function cloneMerchant(sourceId: string, input: Omit<CreateMerchantInput, "subjectId">): Record<string, unknown> {
  const source = db.prepare("SELECT subject_id AS subjectId FROM wechat_merchants WHERE id = ?").get(sourceId) as { subjectId: string } | undefined;
  if (!source) throw new Error("MERCHANT_NOT_FOUND");
  const cloned = createMerchant({ ...input, subjectId: source.subjectId, complaintCount: 0 });
  setMerchantStatus(String(cloned.id), "DISABLED");
  return listMerchants().find((item) => String(item.id) === String(cloned.id)) ?? cloned;
}

export interface CreateConfiguredChannelInput { id: string; subjectId: string; appId: string; merchantId: string; notifyPath?: string; routeWeight?: number; }
export function createConfiguredChannel(input: CreateConfiguredChannelInput): Channel {
  const app = db.prepare("SELECT id, subject_id AS subjectId, status FROM wechat_apps WHERE id = ?").get(input.appId) as { id: string; subjectId: string; status: string } | undefined;
  const merchant = db.prepare("SELECT id, subject_id AS subjectId, status FROM wechat_merchants WHERE id = ?").get(input.merchantId) as { id: string; subjectId: string; status: string } | undefined;
  if (!app) throw new Error("APP_NOT_FOUND");
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  if (app.status !== "ACTIVE") throw new Error("APP_DISABLED");
  if (merchant.status !== "ACTIVE") throw new Error("MERCHANT_DISABLED");
  if (app.subjectId !== input.subjectId || merchant.subjectId !== input.subjectId || app.subjectId !== merchant.subjectId) throw new Error("APP_MERCHANT_SUBJECT_MISMATCH");
  const timestamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO app_mch_bindings (id, app_id, merchant_id) VALUES (?, ?, ?)").run(`binding_${input.id}`, input.appId, input.merchantId);
    db.prepare("INSERT INTO channels (id, subject_id, app_id, merchant_id, notify_path, route_weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.subjectId, input.appId, input.merchantId, `/webhooks/wechatpay/${input.id}`, input.routeWeight ?? 100, timestamp);
    db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)")
      .run(input.id, input.merchantId, timestamp);
  });
  tx();
  const channel = getChannel(input.id);
  if (!channel) throw new Error("CHANNEL_CREATE_FAILED");
  return channel;
}

export function updateConfiguredChannel(id: string, input: Omit<CreateConfiguredChannelInput, "id">): Channel | undefined {
  const app = db.prepare("SELECT id, subject_id AS subjectId, status FROM wechat_apps WHERE id = ?").get(input.appId) as { id: string; subjectId: string; status: string } | undefined;
  const merchant = db.prepare("SELECT id, subject_id AS subjectId, status FROM wechat_merchants WHERE id = ?").get(input.merchantId) as { id: string; subjectId: string; status: string } | undefined;
  if (!app) throw new Error("APP_NOT_FOUND");
  if (!merchant) throw new Error("MERCHANT_NOT_FOUND");
  if (app.status !== "ACTIVE") throw new Error("APP_DISABLED");
  if (merchant.status !== "ACTIVE") throw new Error("MERCHANT_DISABLED");
  if (app.subjectId !== input.subjectId || merchant.subjectId !== input.subjectId || app.subjectId !== merchant.subjectId) throw new Error("APP_MERCHANT_SUBJECT_MISMATCH");
  if (!getChannel(id)) return undefined;
  db.prepare("UPDATE channels SET subject_id = ?, app_id = ?, merchant_id = ?, notify_path = ?, route_weight = ? WHERE id = ?")
    .run(input.subjectId, input.appId, input.merchantId, `/webhooks/wechatpay/${id}`, input.routeWeight ?? 100, id);
  db.prepare("INSERT OR IGNORE INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)")
    .run(id, input.merchantId, nowIso());
  return getChannel(id);
}

export function listChannelPlatformMerchants(channelId: string): Array<Record<string, unknown>> {
  return db.prepare(`SELECT p.id, p.code, p.name, p.status, pmc.created_at AS authorizedAt,
      COALESCE(policy.status, 'ACTIVE') AS policyStatus, COALESCE(policy.route_weight, 100) AS routeWeight,
      COALESCE(policy.max_concurrency, 0) AS maxConcurrency, COALESCE(policy.daily_amount_limit, 0) AS dailyAmountLimit,
      COALESCE(policy.daily_order_limit, 0) AS dailyOrderLimit
    FROM platform_merchant_channels pmc JOIN platform_merchants p ON p.id = pmc.platform_merchant_id
    LEFT JOIN channel_platform_merchant_policies policy ON policy.channel_id = pmc.channel_id AND policy.platform_merchant_id = pmc.platform_merchant_id
    WHERE pmc.channel_id = ? ORDER BY p.name`).all(channelId) as Array<Record<string, unknown>>;
}
export function setChannelPlatformMerchants(channelId: string, platformMerchantIds: string[]): Array<Record<string, unknown>> {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const uniqueIds = [...new Set(platformMerchantIds)];
  if (uniqueIds.length) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM platform_merchants WHERE id IN (${placeholders})`).get(...uniqueIds) as { count: number }).count);
    if (count !== uniqueIds.length) throw new Error("PLATFORM_MERCHANT_NOT_FOUND");
  }
  const paymentMethod: ChannelPaymentMethod = channel.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
  for (const platformMerchantId of uniqueIds) {
    const accounts = listPlatformMerchantWechatBindings(platformMerchantId);
    if (accounts.some((item) => !paymentAppForMerchant(String(item.id), paymentMethod))) throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM platform_merchant_channels WHERE channel_id = ?").run(channelId);
    const insert = db.prepare("INSERT INTO platform_merchant_channels (platform_merchant_id, channel_id, created_at) VALUES (?, ?, ?)");
    const bind = db.prepare("INSERT OR IGNORE INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)");
    for (const merchantId of uniqueIds) {
      insert.run(merchantId, channelId, nowIso());
      for (const account of listPlatformMerchantWechatBindings(merchantId)) bind.run(channelId, String(account.id), nowIso());
    }
  });
  tx(); return listChannelPlatformMerchants(channelId);
}

export function listPlatformMerchantWechatBindings(platformMerchantId: string): Array<Record<string, unknown>> {
  return db.prepare(`SELECT m.id, m.mchid, m.credential_ref AS credentialRef, m.status AS merchantStatus,
      COALESCE((SELECT pm.app_id FROM merchant_payment_methods pm WHERE pm.merchant_id = m.id AND pm.method = 'NATIVE' AND pm.status = 'ACTIVE' ORDER BY pm.created_at LIMIT 1), (SELECT amb.app_id FROM app_mch_bindings amb WHERE amb.merchant_id = m.id ORDER BY amb.id LIMIT 1)) AS appInternalId,
      COALESCE((SELECT a.appid FROM merchant_payment_methods pm2 JOIN wechat_apps a ON a.id = pm2.app_id WHERE pm2.merchant_id = m.id AND pm2.method = 'NATIVE' AND pm2.status = 'ACTIVE' ORDER BY pm2.created_at LIMIT 1), (SELECT a2.appid FROM app_mch_bindings amb2 JOIN wechat_apps a2 ON a2.id = amb2.app_id WHERE amb2.merchant_id = m.id ORDER BY amb2.id LIMIT 1)) AS appId,
      COALESCE((SELECT a3.status FROM merchant_payment_methods pm3 JOIN wechat_apps a3 ON a3.id = pm3.app_id WHERE pm3.merchant_id = m.id AND pm3.method = 'NATIVE' AND pm3.status = 'ACTIVE' ORDER BY pm3.created_at LIMIT 1),
        (SELECT a4.status FROM app_mch_bindings amb3 JOIN wechat_apps a4 ON a4.id = amb3.app_id WHERE amb3.merchant_id = m.id ORDER BY amb3.id LIMIT 1), 'DISABLED') AS appStatus,
      m.daily_amount_limit AS merchantDailyAmountLimit, m.complaint_count AS complaintCount, m.risk_enabled AS riskEnabled,
      m.order_window_seconds AS orderWindowSeconds, m.order_window_limit AS orderWindowLimit,
      m.daily_order_limit AS merchantDailyOrderLimit, m.daily_success_limit AS dailySuccessLimit,
      b.status, b.route_weight AS routeWeight, b.max_concurrency AS maxConcurrency,
      b.min_order_amount AS minOrderAmount, b.max_order_amount AS maxOrderAmount,
      b.daily_amount_limit AS dailyAmountLimit, b.daily_order_limit AS dailyOrderLimit,
      b.created_at AS createdAt, b.updated_at AS updatedAt
    FROM platform_merchant_wechat_bindings b JOIN wechat_merchants m ON m.id = b.wechat_merchant_id
    WHERE b.platform_merchant_id = ? ORDER BY m.mchid`).all(platformMerchantId) as Array<Record<string, unknown>>;
}

export function setPlatformMerchantWechatBindings(platformMerchantId: string, bindings: Array<{ wechatMerchantId: string; status?: string; routeWeight?: number; maxConcurrency?: number; minOrderAmount?: number; maxOrderAmount?: number; dailyAmountLimit?: number; dailyOrderLimit?: number }>): Array<Record<string, unknown>> {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(platformMerchantId)) throw new Error("PLATFORM_MERCHANT_NOT_FOUND");
  const unique = [...new Map(bindings.map((item) => [item.wechatMerchantId, item])).values()];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM platform_merchant_wechat_bindings WHERE platform_merchant_id = ?").run(platformMerchantId);
    const insert = db.prepare(`INSERT INTO platform_merchant_wechat_bindings
      (platform_merchant_id, wechat_merchant_id, status, route_weight, max_concurrency, min_order_amount, max_order_amount, daily_amount_limit, daily_order_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of unique) {
      if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(item.wechatMerchantId)) throw new Error("MERCHANT_NOT_FOUND");
      const now = nowIso(); insert.run(platformMerchantId, item.wechatMerchantId, item.status ?? "ACTIVE", Math.max(1, Number(item.routeWeight ?? 100)), Math.max(0, Number(item.maxConcurrency ?? 0)), Math.max(1, Number(item.minOrderAmount ?? 1)), Math.max(0, Number(item.maxOrderAmount ?? 0)), Math.max(0, Number(item.dailyAmountLimit ?? 0)), Math.max(0, Number(item.dailyOrderLimit ?? 0)), now, now);
      const channels = db.prepare("SELECT channel_id AS channelId FROM platform_merchant_channels WHERE platform_merchant_id = ?").all(platformMerchantId) as Array<{ channelId: string }>;
      const bind = db.prepare("INSERT OR IGNORE INTO channel_merchant_bindings (channel_id, merchant_id, created_at) VALUES (?, ?, ?)");
      for (const channel of channels) {
        const channelConfig = getChannel(channel.channelId);
        const paymentMethod: ChannelPaymentMethod = channelConfig?.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
        if (!paymentAppForMerchant(item.wechatMerchantId, paymentMethod)) throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
        bind.run(channel.channelId, item.wechatMerchantId, now);
      }
    }
  });
  tx(); return listPlatformMerchantWechatBindings(platformMerchantId);
}

export function listChannelPlatformMerchantPolicies(channelId: string): Array<Record<string, unknown>> {
  return listChannelPlatformMerchants(channelId);
}

export function setChannelPlatformMerchantPolicies(channelId: string, policies: Array<{ platformMerchantId: string; status?: string; routeWeight?: number; maxConcurrency?: number; dailyAmountLimit?: number; dailyOrderLimit?: number }>): Array<Record<string, unknown>> {
  if (!getChannel(channelId)) throw new Error("CHANNEL_NOT_FOUND");
  const unique = [...new Map(policies.map((item) => [item.platformMerchantId, item])).values()];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM channel_platform_merchant_policies WHERE channel_id = ?").run(channelId);
    const insert = db.prepare(`INSERT INTO channel_platform_merchant_policies
      (channel_id, platform_merchant_id, status, route_weight, max_concurrency, daily_amount_limit, daily_order_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of unique) {
      if (!db.prepare("SELECT 1 FROM platform_merchant_channels WHERE channel_id = ? AND platform_merchant_id = ?").get(channelId, item.platformMerchantId)) throw new Error("PLATFORM_MERCHANT_NOT_AUTHORIZED");
      const now = nowIso(); insert.run(channelId, item.platformMerchantId, item.status ?? "ACTIVE", Math.max(1, Number(item.routeWeight ?? 100)), Math.max(0, Number(item.maxConcurrency ?? 0)), Math.max(0, Number(item.dailyAmountLimit ?? 0)), Math.max(0, Number(item.dailyOrderLimit ?? 0)), now, now);
    }
  });
  tx(); return listChannelPlatformMerchantPolicies(channelId);
}

export function setAppStatus(id: string, status: "ACTIVE" | "DISABLED"): void { db.prepare("UPDATE wechat_apps SET status = ? WHERE id = ?").run(status, id); }
export function setMerchantStatus(id: string, status: "ACTIVE" | "DISABLED"): void {
  if (status === "ACTIVE") {
    const row = db.prepare("SELECT monitor_locked AS monitorLocked FROM wechat_merchants WHERE id = ?").get(id) as { monitorLocked?: number } | undefined;
    if (Number(row?.monitorLocked || 0) === 1) throw new Error("MERCHANT_MONITOR_LOCKED");
  }
  db.prepare("UPDATE wechat_merchants SET status = ? WHERE id = ?").run(status, id);
}

export type ChannelPaymentMethod = "NATIVE" | "JSAPI";
export interface CreateRoutingChannelInput { id: string; name?: string; merchantIds: string[]; paymentMethod?: ChannelPaymentMethod; notifyPath?: string; routeWeight?: number; }

const UNBOUND_SUBJECT_ID = "subject_unbound";
const UNBOUND_APP_ID = "app_unbound";
const UNBOUND_MERCHANT_ID = "mch_unbound";

function ensureUnboundChannelOwner(timestamp: string): void {
  db.prepare("INSERT OR IGNORE INTO merchant_subjects (id, name, subject_type, created_at) VALUES (?, ?, ?, ?)").run(UNBOUND_SUBJECT_ID, "待绑定通道", "OTHER", timestamp);
  db.prepare("INSERT OR IGNORE INTO wechat_apps (id, subject_id, appid, app_type, status) VALUES (?, ?, ?, ?, 'DISABLED')").run(UNBOUND_APP_ID, UNBOUND_SUBJECT_ID, "unbound_channel_app", "SERVICE_ACCOUNT");
  db.prepare("INSERT OR IGNORE INTO wechat_merchants (id, subject_id, mchid, credential_ref, status) VALUES (?, ?, ?, ?, 'DISABLED')").run(UNBOUND_MERCHANT_ID, UNBOUND_SUBJECT_ID, "unbound_channel_mchid", "");
}

function paymentAppForMerchant(merchantId: string, paymentMethod: ChannelPaymentMethod): { id: string; appid: string; status: string; subjectId: string } | undefined {
  const configured = db.prepare(`SELECT a.id, a.appid, a.status, a.subject_id AS subjectId
    FROM wechat_apps a JOIN merchant_payment_methods pm ON pm.app_id = a.id
    WHERE pm.merchant_id = ? AND pm.method = ? AND pm.status = 'ACTIVE'
    ORDER BY pm.created_at LIMIT 1`).get(merchantId, paymentMethod) as { id: string; appid: string; status: string; subjectId: string } | undefined;
  if (configured || paymentMethod === "JSAPI") return configured;
  return db.prepare(`SELECT a.id, a.appid, a.status, a.subject_id AS subjectId
    FROM wechat_apps a JOIN app_mch_bindings amb ON amb.app_id = a.id
    WHERE amb.merchant_id = ? ORDER BY amb.id LIMIT 1`).get(merchantId) as { id: string; appid: string; status: string; subjectId: string } | undefined;
}

function nativeAppForMerchant(merchantId: string) { return paymentAppForMerchant(merchantId, "NATIVE"); }

export function createRoutingChannel(input: CreateRoutingChannelInput): Channel {
  const merchantIds = [...new Set(input.merchantIds.map((id) => String(id)).filter(Boolean))];
  const paymentMethod: ChannelPaymentMethod = input.paymentMethod === "JSAPI" ? "JSAPI" : "NATIVE";
  if (!merchantIds.length) {
    const timestamp = nowIso();
    db.transaction(() => {
      ensureUnboundChannelOwner(timestamp);
      db.prepare("INSERT INTO channels (id, name, subject_id, app_id, merchant_id, notify_path, route_weight, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.id, input.name?.trim() || input.id, UNBOUND_SUBJECT_ID, UNBOUND_APP_ID, UNBOUND_MERCHANT_ID, input.notifyPath || `/webhooks/wechatpay/${input.id}`, input.routeWeight ?? 100, paymentMethod, timestamp);
    })();
    const unboundChannel = getChannel(input.id);
    if (!unboundChannel) throw new Error("CHANNEL_CREATE_FAILED");
    return unboundChannel;
  }
  const merchants = merchantIds.map((id) => db.prepare("SELECT id, status FROM wechat_merchants WHERE id = ?").get(id) as { id: string; status: string } | undefined);
  if (merchants.some((merchant) => !merchant)) throw new Error("MERCHANT_NOT_FOUND");
  if (merchants.some((merchant) => merchant!.status !== "ACTIVE")) throw new Error("MERCHANT_DISABLED");
  const paymentApps = merchantIds.map((merchantId) => paymentAppForMerchant(merchantId, paymentMethod));
  if (paymentApps.some((app) => !app || app.status !== "ACTIVE")) throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
  const primary = paymentApps[0]!;
  const timestamp = nowIso();
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO channels (id, name, subject_id, app_id, merchant_id, notify_path, route_weight, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.name?.trim() || input.id, primary.subjectId, primary.id, merchantIds[0], input.notifyPath || `/webhooks/wechatpay/${input.id}`, input.routeWeight ?? 100, paymentMethod, timestamp);
    const insert = db.prepare("INSERT INTO channel_merchant_bindings (channel_id, merchant_id, binding_status, created_at) VALUES (?, ?, 'ACTIVE', ?)");
    for (const merchantId of merchantIds) insert.run(input.id, merchantId, timestamp);
  });
  tx();
  const channel = getChannel(input.id);
  if (!channel) throw new Error("CHANNEL_CREATE_FAILED");
  return channel;
}

export function updateRoutingChannel(id: string, input: { name?: string; merchantIds?: string[]; paymentMethod?: ChannelPaymentMethod; notifyPath?: string; routeWeight?: number }): Channel | undefined {
  const current = getChannel(id);
  if (!current) return undefined;
  if (input.merchantIds) setChannelMerchantBindings(id, input.merchantIds);
  const paymentMethod: ChannelPaymentMethod = input.paymentMethod === "JSAPI" ? "JSAPI" : input.paymentMethod === "NATIVE" ? "NATIVE" : (current.paymentMethod || "NATIVE");
  const merchantIds = input.merchantIds || listChannelMerchants(id).filter((item) => String(item.bindingStatus) === "ACTIVE").map((item) => String(item.id));
  if (!merchantIds.length || current.merchantInternalId === UNBOUND_MERCHANT_ID) {
    db.prepare("UPDATE channels SET name = COALESCE(?, name), payment_method = ?, notify_path = COALESCE(?, notify_path), route_weight = COALESCE(?, route_weight) WHERE id = ?")
      .run(input.name?.trim() || null, paymentMethod, input.notifyPath ?? null, input.routeWeight ?? null, id);
    return getChannel(id);
  }
  const primaryId = merchantIds[0] || current.merchantInternalId;
  const paymentApps = merchantIds.map((merchantId) => paymentAppForMerchant(String(merchantId), paymentMethod));
  if (paymentApps.some((app) => !app || app.status !== "ACTIVE")) throw new Error(paymentMethod === "JSAPI" ? "MERCHANT_JSAPI_APP_REQUIRED" : "MERCHANT_NATIVE_APP_REQUIRED");
  const primary = paymentApps[0];
  if (!primary || !primaryId) throw new Error("CHANNEL_MERCHANT_REQUIRED");
  db.prepare("UPDATE channels SET name = COALESCE(?, name), subject_id = ?, app_id = ?, merchant_id = ?, payment_method = ?, notify_path = COALESCE(?, notify_path), route_weight = COALESCE(?, route_weight) WHERE id = ?")
    .run(input.name?.trim() || null, primary.subjectId, primary.id, primaryId, paymentMethod, input.notifyPath ?? null, input.routeWeight ?? null, id);
  return getChannel(id);
}
export function setMerchantMonitorLock(id: string, reason: string, source = "WECHAT_API"): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(id)) return undefined;
  db.prepare("UPDATE wechat_merchants SET status = 'DISABLED', monitor_locked = 1, monitor_lock_reason = ?, monitor_locked_at = ?, monitor_lock_source = ? WHERE id = ?")
    .run(String(reason || "微信接口风控或权限异常").slice(0, 512), nowIso(), source, id);
  return listMerchants().find((item) => String(item.id) === id);
}
export function forceEnableMerchantStatus(id: string): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(id)) return undefined;
  db.prepare("UPDATE wechat_merchants SET status = 'ACTIVE', monitor_locked = 0, monitor_lock_reason = NULL, monitor_locked_at = NULL, monitor_lock_source = NULL WHERE id = ?").run(id);
  return listMerchants().find((item) => String(item.id) === id);
}
export function updateMerchantSettings(id: string, input: { dailyAmountLimit?: number; complaintCount?: number; riskEnabled?: number; orderWindowSeconds?: number; orderWindowLimit?: number; dailyOrderLimit?: number; dailySuccessLimit?: number }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(id)) return undefined;
  const daily = input.dailyAmountLimit == null ? undefined : Math.max(0, Math.floor(input.dailyAmountLimit));
  const complaints = input.complaintCount == null ? undefined : Math.max(0, Math.floor(input.complaintCount));
  const riskEnabled = input.riskEnabled == null ? undefined : (Number(input.riskEnabled) ? 1 : 0);
  const windowSeconds = input.orderWindowSeconds == null ? undefined : Math.max(0, Math.floor(input.orderWindowSeconds));
  const windowLimit = input.orderWindowLimit == null ? undefined : Math.max(0, Math.floor(input.orderWindowLimit));
  const dailyOrders = input.dailyOrderLimit == null ? undefined : Math.max(0, Math.floor(input.dailyOrderLimit));
  const dailySuccess = input.dailySuccessLimit == null ? undefined : Math.max(0, Math.floor(input.dailySuccessLimit));
  if ((windowSeconds ?? 0) > 0 && (windowLimit ?? 0) === 0) throw new Error("ORDER_WINDOW_LIMIT_REQUIRED");
  if ((windowSeconds ?? 0) === 0 && (windowLimit ?? 0) > 0) throw new Error("ORDER_WINDOW_SECONDS_REQUIRED");
  db.prepare("UPDATE wechat_merchants SET daily_amount_limit = COALESCE(?, daily_amount_limit), complaint_count = COALESCE(?, complaint_count), risk_enabled = COALESCE(?, risk_enabled), order_window_seconds = COALESCE(?, order_window_seconds), order_window_limit = COALESCE(?, order_window_limit), daily_order_limit = COALESCE(?, daily_order_limit), daily_success_limit = COALESCE(?, daily_success_limit) WHERE id = ?").run(daily ?? null, complaints ?? null, riskEnabled ?? null, windowSeconds ?? null, windowLimit ?? null, dailyOrders ?? null, dailySuccess ?? null, id);
  return listMerchants().find((item) => String(item.id) === id);
}
export function updateMerchant(id: string, input: { credentialRef?: string; dailyAmountLimit?: number }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(id)) return undefined;
  const daily = input.dailyAmountLimit == null ? undefined : Math.max(0, Math.floor(input.dailyAmountLimit));
  db.prepare("UPDATE wechat_merchants SET credential_ref = COALESCE(?, credential_ref), daily_amount_limit = COALESCE(?, daily_amount_limit) WHERE id = ?")
    .run(input.credentialRef ?? null, daily ?? null, id);
  return listMerchants().find((item) => String(item.id) === id);
}
export function deleteMerchant(id: string): void {
  if (!db.prepare("SELECT id FROM wechat_merchants WHERE id = ?").get(id)) throw new Error("MERCHANT_NOT_FOUND");
  const orderCount = Number((db.prepare("SELECT COUNT(*) AS count FROM orders WHERE wechat_merchant_id = ?").get(id) as { count: number }).count);
  const channelCount = Number((db.prepare("SELECT COUNT(*) AS count FROM channels WHERE merchant_id = ?").get(id) as { count: number }).count);
  const bindingCount = Number((db.prepare("SELECT COUNT(*) AS count FROM channel_merchant_bindings WHERE merchant_id = ?").get(id) as { count: number }).count);
  if (orderCount || channelCount || bindingCount) throw new Error("MERCHANT_IN_USE");
  db.prepare("DELETE FROM app_mch_bindings WHERE merchant_id = ?").run(id);
  db.prepare("DELETE FROM wechat_merchants WHERE id = ?").run(id);
}

function apiKeyHash(apiKey: string): string { return crypto.createHash("sha256").update(apiKey).digest("hex"); }
export function createPlatformMerchant(input: { id: string; code: string; name: string; settlementRate?: number; maxOrderAmount?: number; dailyAmountLimit?: number; dailyOrderLimit?: number }): Record<string, unknown> & { apiKey: string } {
  const apiKey = `cm_${crypto.randomBytes(24).toString("base64url")}`;
  const timestamp = nowIso();
  db.prepare("INSERT INTO platform_merchants (id, code, name, api_key_hash, settlement_rate, max_order_amount, daily_amount_limit, daily_order_limit, status_reason, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.id, input.code, input.name, apiKeyHash(apiKey), input.settlementRate ?? 0, input.maxOrderAmount ?? 10_000_000, input.dailyAmountLimit ?? 0, input.dailyOrderLimit ?? 0, "新建码商", timestamp, timestamp);
  ensureMerchantFinancialRecords(input.id);
  return { ...(db.prepare("SELECT id, code, name, status, settlement_rate AS settlementRate, max_order_amount AS maxOrderAmount, daily_amount_limit AS dailyAmountLimit, daily_order_limit AS dailyOrderLimit, status_reason AS statusReason, updated_at AS updatedAt, last_active_at AS lastActiveAt, created_at AS createdAt FROM platform_merchants WHERE id = ?").get(input.id) as Record<string, unknown>), apiKey };
}
export function createMerchantUser(input: { merchantId: string; username: string; passwordHash: string; role?: "OWNER" | "OPERATOR" | "FINANCE" | "VIEWER" }): Record<string, unknown> {
  const id = randomId("muser");
  db.prepare("INSERT INTO merchant_users (id, merchant_id, username, password_hash, role, status, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?)")
    .run(id, input.merchantId, input.username, input.passwordHash, input.role ?? "OWNER", nowIso());
  return db.prepare("SELECT id, merchant_id AS merchantId, username, role, status, must_change_password AS mustChangePassword, created_at AS createdAt, last_login_at AS lastLoginAt FROM merchant_users WHERE id = ?").get(id) as Record<string, unknown>;
}
export function listMerchantUsers(merchantId: string): Array<Record<string, unknown>> {
  return db.prepare("SELECT id, merchant_id AS merchantId, username, role, status, must_change_password AS mustChangePassword, created_at AS createdAt, last_login_at AS lastLoginAt FROM merchant_users WHERE merchant_id = ? ORDER BY created_at DESC").all(merchantId) as Array<Record<string, unknown>>;
}
export function createMerchantUserSession(userId: string, merchantId: string, tokenHash: string, expiresAt: string): void {
  db.prepare("INSERT INTO merchant_user_sessions (token_hash, user_id, merchant_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(tokenHash, userId, merchantId, expiresAt, nowIso());
}
export interface MerchantQuotaPolicy {
  merchantId: string; minOrderAmount: number; maxOrderAmount: number; dailyAmountLimit: number; dailyOrderLimit: number;
  pendingAmountLimit: number; pendingOrderLimit: number; creditWarningAmount: number; warningRatio: number; criticalRatio: number; enabled: number;
}

export function ensureMerchantFinancialRecords(merchantId: string): void {
  const merchant = db.prepare("SELECT id, max_order_amount AS maxOrderAmount, daily_amount_limit AS dailyAmountLimit, daily_order_limit AS dailyOrderLimit FROM platform_merchants WHERE id = ?").get(merchantId) as Record<string, unknown> | undefined;
  if (!merchant) return;
  const now = nowIso();
  const tx = db.transaction(() => {
    const account = db.prepare("SELECT merchant_id FROM merchant_accounts WHERE merchant_id = ?").get(merchantId);
    if (!account) {
      const received = Number((db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'").get(merchantId) as { amount: number }).amount);
      const refunded = Number((db.prepare("SELECT COALESCE(SUM(r.refund_amount), 0) AS amount FROM refund_orders r JOIN orders o ON o.id = r.order_id WHERE o.merchant_id = ? AND r.status = 'SUCCESS'").get(merchantId) as { amount: number }).amount);
      const settled = Number((db.prepare("SELECT COALESCE(SUM(net_amount), 0) AS amount FROM settlement_statements WHERE merchant_id = ? AND status = 'PAID'").get(merchantId) as { amount: number }).amount);
      const pending = Number((db.prepare("SELECT COALESCE(SUM(net_amount), 0) AS amount FROM settlement_statements WHERE merchant_id = ? AND status IN ('DRAFT','CONFIRMED')").get(merchantId) as { amount: number }).amount);
      const available = Math.max(0, received - refunded - settled - pending);
      db.prepare(`INSERT INTO merchant_accounts (merchant_id, available_balance, pending_settlement, frozen_balance, total_received, total_refunded, total_settled, quota_total, quota_used, quota_reserved, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, 0, 0, 0, ?)`).run(merchantId, available, pending, received, refunded, settled, now);
      db.prepare(`INSERT OR IGNORE INTO merchant_ledger_entries
        (id, merchant_id, entry_type, amount, available_before, available_after, pending_before, pending_after, frozen_before, frozen_after, reference_type, reference_id, idempotency_key, note, created_at)
        VALUES (?, ?, 'INITIAL_BACKFILL', ?, 0, ?, 0, ?, 0, 0, 'SYSTEM', ?, ?, '历史订单余额初始化', ?)`) 
        .run(randomId("ledger"), merchantId, received - refunded - settled - pending, available, pending, merchantId, `initial:${merchantId}`, now);
    }
    if (!db.prepare("SELECT merchant_id FROM merchant_quota_policies WHERE merchant_id = ?").get(merchantId)) {
      db.prepare(`INSERT INTO merchant_quota_policies (merchant_id, min_order_amount, max_order_amount, daily_amount_limit, daily_order_limit, updated_at)
        VALUES (?, 1, ?, ?, ?, ?)`).run(merchantId, Number(merchant.maxOrderAmount || 10_000_000), Number(merchant.dailyAmountLimit || 0), Number(merchant.dailyOrderLimit || 0), now);
    }
  });
  tx();
}

export function getMerchantQuotaPolicy(merchantId: string): MerchantQuotaPolicy | undefined {
  ensureMerchantFinancialRecords(merchantId);
  return db.prepare(`SELECT merchant_id AS merchantId, min_order_amount AS minOrderAmount, max_order_amount AS maxOrderAmount,
    daily_amount_limit AS dailyAmountLimit, daily_order_limit AS dailyOrderLimit, pending_amount_limit AS pendingAmountLimit,
    pending_order_limit AS pendingOrderLimit, credit_warning_amount AS creditWarningAmount, warning_ratio AS warningRatio, critical_ratio AS criticalRatio, enabled
    FROM merchant_quota_policies WHERE merchant_id = ?`).get(merchantId) as MerchantQuotaPolicy | undefined;
}

function merchantQuotaUsage(merchantId: string): { dailyOrderCount: number; dailyAmount: number; reservedAmount: number; reservedOrderCount: number } {
  // 业务日按北京时间计算；数据库统一保存 UTC ISO 时间。
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const orders = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM orders WHERE merchant_id = ? AND date(created_at, '+8 hours') = ?").get(merchantId, day) as { count: number; amount: number };
  const reserved = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM merchant_quota_reservations WHERE merchant_id = ? AND status = 'RESERVED'").get(merchantId) as { count: number; amount: number };
  return { dailyOrderCount: Number(orders.count), dailyAmount: Number(orders.amount), reservedAmount: Number(reserved.amount), reservedOrderCount: Number(reserved.count) };
}

function merchantCreditAccount(merchantId: string): { quotaTotal: number; quotaUsed: number; quotaReserved: number; quotaBalance: number } {
  const row = db.prepare("SELECT quota_total AS quotaTotal, quota_used AS quotaUsed, quota_reserved AS quotaReserved FROM merchant_accounts WHERE merchant_id = ?").get(merchantId) as { quotaTotal: number; quotaUsed: number; quotaReserved: number };
  return { quotaTotal: Number(row.quotaTotal), quotaUsed: Number(row.quotaUsed), quotaReserved: Number(row.quotaReserved), quotaBalance: Math.max(0, Number(row.quotaTotal) - Number(row.quotaUsed)) };
}

export function checkMerchantOrderRisk(merchantId: string, amount: number): { allowed: boolean; reason?: string; dailyOrderCount: number; dailyAmount: number; maxOrderAmount: number; minOrderAmount: number; dailyOrderLimit: number; dailyAmountLimit: number; pendingAmountLimit: number; pendingOrderLimit: number; reservedAmount: number; quotaTotal: number; quotaUsed: number; quotaReserved: number; quotaBalance: number } {
  const policy = getMerchantQuotaPolicy(merchantId);
  if (!policy) return { allowed: false, reason: "PLATFORM_MERCHANT_NOT_FOUND", dailyOrderCount: 0, dailyAmount: 0, maxOrderAmount: 0, minOrderAmount: 0, dailyOrderLimit: 0, dailyAmountLimit: 0, pendingAmountLimit: 0, pendingOrderLimit: 0, reservedAmount: 0, quotaTotal: 0, quotaUsed: 0, quotaReserved: 0, quotaBalance: 0 };
  const usage = merchantQuotaUsage(merchantId);
  const credit = merchantCreditAccount(merchantId);
  let reason: string | undefined;
  if (!policy.enabled) reason = "MERCHANT_QUOTA_DISABLED";
  else if (amount < policy.minOrderAmount) reason = "ORDER_AMOUNT_BELOW_MINIMUM";
  else if (amount > policy.maxOrderAmount) reason = "ORDER_AMOUNT_LIMIT_EXCEEDED";
  else if (policy.dailyOrderLimit > 0 && usage.dailyOrderCount >= policy.dailyOrderLimit) reason = "DAILY_ORDER_LIMIT_EXCEEDED";
  else if (policy.dailyAmountLimit > 0 && usage.dailyAmount + amount > policy.dailyAmountLimit) reason = "DAILY_AMOUNT_LIMIT_EXCEEDED";
  else if (policy.pendingOrderLimit > 0 && usage.reservedOrderCount >= policy.pendingOrderLimit) reason = "PENDING_ORDER_LIMIT_EXCEEDED";
  else if (policy.pendingAmountLimit > 0 && usage.reservedAmount + amount > policy.pendingAmountLimit) reason = "PENDING_AMOUNT_LIMIT_EXCEEDED";
  else if (credit.quotaTotal > 0 && credit.quotaBalance - credit.quotaReserved < amount) reason = "MERCHANT_BALANCE_INSUFFICIENT";
  return { allowed: !reason, reason, dailyOrderCount: usage.dailyOrderCount, dailyAmount: usage.dailyAmount, maxOrderAmount: policy.maxOrderAmount, minOrderAmount: policy.minOrderAmount, dailyOrderLimit: policy.dailyOrderLimit, dailyAmountLimit: policy.dailyAmountLimit, pendingAmountLimit: policy.pendingAmountLimit, pendingOrderLimit: policy.pendingOrderLimit, reservedAmount: usage.reservedAmount, ...credit };
}

export function reserveMerchantQuota(merchantId: string, orderId: string, amount: number): void {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return;
  ensureMerchantFinancialRecords(merchantId);
  const tx = db.transaction(() => {
    const policy = db.prepare(`SELECT min_order_amount AS minOrderAmount, max_order_amount AS maxOrderAmount, daily_amount_limit AS dailyAmountLimit,
      daily_order_limit AS dailyOrderLimit, pending_amount_limit AS pendingAmountLimit, pending_order_limit AS pendingOrderLimit, enabled
      FROM merchant_quota_policies WHERE merchant_id = ?`).get(merchantId) as MerchantQuotaPolicy | undefined;
    if (!policy) throw new Error("PLATFORM_MERCHANT_NOT_FOUND");
    const usage = merchantQuotaUsage(merchantId); const credit = merchantCreditAccount(merchantId);
    let reason: string | undefined;
    if (!policy.enabled) reason = "MERCHANT_QUOTA_DISABLED";
    else if (amount < policy.minOrderAmount) reason = "ORDER_AMOUNT_BELOW_MINIMUM";
    else if (amount > policy.maxOrderAmount) reason = "ORDER_AMOUNT_LIMIT_EXCEEDED";
    else if (policy.dailyOrderLimit > 0 && usage.dailyOrderCount >= policy.dailyOrderLimit) reason = "DAILY_ORDER_LIMIT_EXCEEDED";
    else if (policy.dailyAmountLimit > 0 && usage.dailyAmount + amount > policy.dailyAmountLimit) reason = "DAILY_AMOUNT_LIMIT_EXCEEDED";
    else if (policy.pendingOrderLimit > 0 && usage.reservedOrderCount >= policy.pendingOrderLimit) reason = "PENDING_ORDER_LIMIT_EXCEEDED";
    else if (policy.pendingAmountLimit > 0 && usage.reservedAmount + amount > policy.pendingAmountLimit) reason = "PENDING_AMOUNT_LIMIT_EXCEEDED";
    else if (credit.quotaTotal > 0 && credit.quotaBalance - credit.quotaReserved < amount) reason = "MERCHANT_BALANCE_INSUFFICIENT";
    if (reason) throw new Error(reason);
    db.prepare("INSERT INTO merchant_quota_reservations (id, merchant_id, order_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'RESERVED', ?)")
      .run(randomId("quota"), merchantId, orderId, amount, nowIso());
    db.prepare("UPDATE merchant_accounts SET quota_reserved = quota_reserved + ?, updated_at = ? WHERE merchant_id = ?").run(amount, nowIso(), merchantId);
  });
  tx();
  refreshMerchantAlerts(merchantId);
}

export function releaseMerchantQuota(orderId: string): void {
  const reservation = db.prepare("SELECT merchant_id AS merchantId, amount FROM merchant_quota_reservations WHERE order_id = ? AND status = 'RESERVED'").get(orderId) as { merchantId: string; amount: number } | undefined;
  if (!reservation) return;
  const now = nowIso(); db.transaction(() => { db.prepare("UPDATE merchant_quota_reservations SET status = 'RELEASED', released_at = ? WHERE order_id = ? AND status = 'RESERVED'").run(now, orderId); db.prepare("UPDATE merchant_accounts SET quota_reserved = MAX(0, quota_reserved - ?), updated_at = ? WHERE merchant_id = ?").run(Number(reservation.amount), now, reservation.merchantId); })(); refreshMerchantAlerts(reservation.merchantId);
}

export function consumeMerchantQuota(orderId: string): void {
  const reservation = db.prepare("SELECT merchant_id AS merchantId, amount FROM merchant_quota_reservations WHERE order_id = ? AND status = 'RESERVED'").get(orderId) as { merchantId: string; amount: number } | undefined;
  if (!reservation) return;
  const now = nowIso(); db.transaction(() => { const account = merchantCreditAccount(reservation.merchantId); const after = Math.max(0, account.quotaBalance - Number(reservation.amount)); db.prepare("UPDATE merchant_quota_reservations SET status = 'CONSUMED', released_at = ? WHERE order_id = ? AND status = 'RESERVED'").run(now, orderId); db.prepare("UPDATE merchant_accounts SET quota_reserved = MAX(0, quota_reserved - ?), quota_used = quota_used + ?, updated_at = ? WHERE merchant_id = ?").run(Number(reservation.amount), Number(reservation.amount), now, reservation.merchantId); db.prepare(`INSERT INTO merchant_credit_ledger (id, merchant_id, entry_type, amount, quota_before, quota_after, reference_type, reference_id, idempotency_key, note, created_at) VALUES (?, ?, 'ORDER_CONSUME', ?, ?, ?, 'ORDER', ?, ?, ?, ?)`).run(randomId("credit"), reservation.merchantId, -Number(reservation.amount), account.quotaBalance, after, orderId, `credit:order:${orderId}:consume`, "订单收款扣减码商余额", now); })();
}

export function appendMerchantLedger(input: { merchantId: string; entryType: string; amount: number; availableDelta?: number; pendingDelta?: number; frozenDelta?: number; referenceType?: string; referenceId?: string; idempotencyKey: string; note?: string }): Record<string, unknown> {
  ensureMerchantFinancialRecords(input.merchantId);
  const existing = db.prepare("SELECT * FROM merchant_ledger_entries WHERE idempotency_key = ?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) return existing;
  const tx = db.transaction(() => {
    const account = db.prepare("SELECT * FROM merchant_accounts WHERE merchant_id = ?").get(input.merchantId) as { available_balance: number; pending_settlement: number; frozen_balance: number };
    const availableBefore = Number(account.available_balance); const pendingBefore = Number(account.pending_settlement); const frozenBefore = Number(account.frozen_balance);
    const availableAfter = availableBefore + Number(input.availableDelta || 0); const pendingAfter = pendingBefore + Number(input.pendingDelta || 0); const frozenAfter = frozenBefore + Number(input.frozenDelta || 0);
    if (availableAfter < 0 || pendingAfter < 0 || frozenAfter < 0) throw new Error("MERCHANT_BALANCE_INSUFFICIENT");
    const id = randomId("ledger"); const now = nowIso();
    db.prepare(`INSERT INTO merchant_ledger_entries (id, merchant_id, entry_type, amount, available_before, available_after, pending_before, pending_after, frozen_before, frozen_after, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.merchantId, input.entryType, input.amount, availableBefore, availableAfter, pendingBefore, pendingAfter, frozenBefore, frozenAfter, input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.note ?? null, now);
    db.prepare(`UPDATE merchant_accounts SET available_balance = ?, pending_settlement = ?, frozen_balance = ?, total_received = total_received + ?, total_refunded = total_refunded + ?, total_settled = total_settled + ?, updated_at = ? WHERE merchant_id = ?`)
      .run(availableAfter, pendingAfter, frozenAfter, input.entryType === "ORDER_SUCCESS" ? input.amount : 0, input.entryType === "REFUND_SUCCESS" ? Math.abs(input.amount) : 0, input.entryType === "SETTLEMENT_PAID" ? Math.abs(input.amount) : 0, now, input.merchantId);
    return db.prepare("SELECT * FROM merchant_ledger_entries WHERE id = ?").get(id) as Record<string, unknown>;
  });
  const entry = tx() as Record<string, unknown>;
  refreshMerchantAlerts(input.merchantId);
  return entry;
}

export function recordMerchantOrderSuccess(merchantId: string, orderId: string, amount: number): void { if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return; consumeMerchantQuota(orderId); appendMerchantLedger({ merchantId, entryType: "ORDER_SUCCESS", amount, availableDelta: amount, referenceType: "ORDER", referenceId: orderId, idempotencyKey: `order:${orderId}:success`, note: "订单支付成功" }); }
export function recordMerchantOrderFailure(orderId: string): void { releaseMerchantQuota(orderId); }
export function recordMerchantRefundSuccess(refundNo: string, merchantId: string, amount: number): void { if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return; appendMerchantLedger({ merchantId, entryType: "REFUND_SUCCESS", amount: -Math.abs(amount), availableDelta: -Math.abs(amount), referenceType: "REFUND", referenceId: refundNo, idempotencyKey: `refund:${refundNo}:success`, note: "退款成功" }); }

export function getMerchantFinancialOverview(merchantId: string): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return undefined;
  ensureMerchantFinancialRecords(merchantId); const account = db.prepare(`SELECT merchant_id AS merchantId, available_balance AS availableBalance, pending_settlement AS pendingSettlement, frozen_balance AS frozenBalance, total_received AS totalReceived, total_refunded AS totalRefunded, total_settled AS totalSettled, quota_total AS quotaTotal, quota_used AS quotaUsed, quota_reserved AS quotaReserved, updated_at AS updatedAt FROM merchant_accounts WHERE merchant_id = ?`).get(merchantId) as Record<string, unknown>;
  account.quotaBalance = Math.max(0, Number(account.quotaTotal || 0) - Number(account.quotaUsed || 0));
  const policy = getMerchantQuotaPolicy(merchantId)!; const usage = merchantQuotaUsage(merchantId); const credit = merchantCreditAccount(merchantId); const dailyRatio = policy.dailyAmountLimit ? usage.dailyAmount / policy.dailyAmountLimit : 0; const pendingRatio = policy.pendingAmountLimit ? usage.reservedAmount / policy.pendingAmountLimit : 0; const creditRatio = credit.quotaTotal ? credit.quotaUsed / credit.quotaTotal : 0;
  const alerts = db.prepare("SELECT COUNT(*) AS count FROM merchant_alert_events WHERE merchant_id = ? AND status = 'OPEN'").get(merchantId) as { count: number };
  return { ...account, ...credit, policy, usage, dailyRatio, pendingRatio, creditRatio, openAlertCount: Number(alerts.count) };
}

export function updateMerchantQuotaPolicy(id: string, input: Partial<Omit<MerchantQuotaPolicy, "merchantId">>): MerchantQuotaPolicy | undefined {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(id)) return undefined; ensureMerchantFinancialRecords(id);
  db.prepare(`UPDATE merchant_quota_policies SET min_order_amount = COALESCE(?, min_order_amount), max_order_amount = COALESCE(?, max_order_amount), daily_amount_limit = COALESCE(?, daily_amount_limit), daily_order_limit = COALESCE(?, daily_order_limit), pending_amount_limit = COALESCE(?, pending_amount_limit), pending_order_limit = COALESCE(?, pending_order_limit), credit_warning_amount = COALESCE(?, credit_warning_amount), warning_ratio = COALESCE(?, warning_ratio), critical_ratio = COALESCE(?, critical_ratio), enabled = COALESCE(?, enabled), updated_at = ? WHERE merchant_id = ?`).run(input.minOrderAmount ?? null, input.maxOrderAmount ?? null, input.dailyAmountLimit ?? null, input.dailyOrderLimit ?? null, input.pendingAmountLimit ?? null, input.pendingOrderLimit ?? null, input.creditWarningAmount ?? null, input.warningRatio ?? null, input.criticalRatio ?? null, input.enabled ?? null, nowIso(), id);
  refreshMerchantAlerts(id);
  return getMerchantQuotaPolicy(id);
}

export function adjustMerchantCredit(merchantId: string, input: { delta?: number; balance?: number; note?: string; operator?: string }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return undefined;
  ensureMerchantFinancialRecords(merchantId);
  const tx = db.transaction(() => {
    const account = merchantCreditAccount(merchantId);
    const nextTotal = input.balance != null ? Math.floor(input.balance) : account.quotaTotal + Math.floor(input.delta || 0);
    if (nextTotal < account.quotaUsed + account.quotaReserved) throw new Error("MERCHANT_BALANCE_BELOW_USED");
    const amount = nextTotal - account.quotaTotal; const now = nowIso();
    db.prepare("UPDATE merchant_accounts SET quota_total = ?, updated_at = ? WHERE merchant_id = ?").run(nextTotal, now, merchantId);
    db.prepare(`INSERT INTO merchant_credit_ledger (id, merchant_id, entry_type, amount, quota_before, quota_after, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`).run(randomId("credit"), merchantId, amount >= 0 ? "GRANT" : "DEDUCT", amount, account.quotaTotal, nextTotal, input.operator ?? "local-admin", `credit:${merchantId}:${now}`, input.note ?? (amount >= 0 ? "平台增加码商余额" : "平台扣减码商余额"), now);
    return merchantCreditAccount(merchantId);
  });
  return tx() as Record<string, unknown>;
}
export function adjustMerchantBalance(merchantId: string, input: { delta?: number; balance?: number; note?: string; operator?: string }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return undefined;
  ensureMerchantFinancialRecords(merchantId);
  const tx = db.transaction(() => {
    const account = db.prepare("SELECT available_balance AS availableBalance, pending_settlement AS pendingSettlement, frozen_balance AS frozenBalance FROM merchant_accounts WHERE merchant_id = ?").get(merchantId) as { availableBalance: number; pendingSettlement: number; frozenBalance: number };
    const before = Number(account.availableBalance || 0);
    const after = input.balance != null ? Math.floor(input.balance) : before + Math.floor(input.delta || 0);
    if (after < 0) throw new Error("MERCHANT_BALANCE_INSUFFICIENT");
    const amount = after - before; const now = nowIso();
    db.prepare(`INSERT INTO merchant_ledger_entries
      (id, merchant_id, entry_type, amount, available_before, available_after, pending_before, pending_after, frozen_before, frozen_after, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, ?, 'ADMIN_ADJUST', ?, ?, ?, ?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`)
      .run(randomId("ledger"), merchantId, amount, before, after, account.pendingSettlement, account.pendingSettlement, account.frozenBalance, account.frozenBalance, input.operator ?? "local-admin", `balance:${merchantId}:${now}`, input.note ?? (amount >= 0 ? "平台增加码商余额" : "平台扣减码商余额"), now);
    db.prepare("UPDATE merchant_accounts SET available_balance = ?, updated_at = ? WHERE merchant_id = ?").run(after, now, merchantId);
    return getMerchantFinancialOverview(merchantId);
  });
  const result = tx() as Record<string, unknown>;
  refreshMerchantAlerts(merchantId);
  return result;
}

export function transferMerchantBalanceToCredit(merchantId: string, input: { amount: number; note?: string; operator?: string }): Record<string, unknown> | undefined {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return undefined;
  ensureMerchantFinancialRecords(merchantId);
  const amount = Math.floor(Number(input.amount));
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("INVALID_TRANSFER_AMOUNT");
  const tx = db.transaction(() => {
    const account = db.prepare(`SELECT available_balance AS availableBalance, pending_settlement AS pendingSettlement, frozen_balance AS frozenBalance,
      quota_total AS quotaTotal, quota_used AS quotaUsed, quota_reserved AS quotaReserved FROM merchant_accounts WHERE merchant_id = ?`).get(merchantId) as {
      availableBalance: number; pendingSettlement: number; frozenBalance: number; quotaTotal: number; quotaUsed: number; quotaReserved: number;
    };
    const availableBefore = Number(account.availableBalance || 0);
    if (amount > availableBefore) throw new Error("MERCHANT_BALANCE_INSUFFICIENT");
    const quotaBefore = Number(account.quotaTotal || 0) - Number(account.quotaUsed || 0);
    const availableAfter = availableBefore - amount;
    const quotaAfter = quotaBefore + amount;
    const now = nowIso();
    const referenceId = `${merchantId}:${now}`;
    const note = input.note || "代收余额转入预付";
    db.prepare(`INSERT INTO merchant_ledger_entries
      (id, merchant_id, entry_type, amount, available_before, available_after, pending_before, pending_after, frozen_before, frozen_after, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, ?, 'TRANSFER_TO_PREPAID', ?, ?, ?, ?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`)
      .run(randomId("ledger"), merchantId, -amount, availableBefore, availableAfter, account.pendingSettlement, account.pendingSettlement, account.frozenBalance, account.frozenBalance, referenceId, `transfer:${merchantId}:${now}`, note, now);
    db.prepare(`INSERT INTO merchant_credit_ledger (id, merchant_id, entry_type, amount, quota_before, quota_after, reference_type, reference_id, idempotency_key, note, created_at)
      VALUES (?, ?, 'TRANSFER_IN', ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`)
      .run(randomId("credit"), merchantId, amount, quotaBefore, quotaAfter, referenceId, `transfer:${merchantId}:${now}`, note, now);
    db.prepare("UPDATE merchant_accounts SET available_balance = ?, quota_total = quota_total + ?, updated_at = ? WHERE merchant_id = ?")
      .run(availableAfter, amount, now, merchantId);
    return getMerchantFinancialOverview(merchantId);
  });
  const result = tx() as Record<string, unknown>;
  refreshMerchantAlerts(merchantId);
  return result;
}
export function listMerchantCreditLedger(merchantId: string, limit = 100): Array<Record<string, unknown>> {
  ensureMerchantFinancialRecords(merchantId);
  return db.prepare(`SELECT id, entry_type AS entryType, amount, quota_before AS quotaBefore, quota_after AS quotaAfter, reference_type AS referenceType, reference_id AS referenceId, note, created_at AS createdAt FROM merchant_credit_ledger WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`).all(merchantId, Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>;
}

export interface MerchantLedgerSearchInput {
  merchantId?: string;
  merchantIds?: string[];
  entryType?: string;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function searchMerchantLedger(input: MerchantLedgerSearchInput = {}): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; metrics: Record<string, number> } {
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || 50), 200));
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (input.merchantId) { where.push("l.merchant_id = ?"); params.push(input.merchantId); }
  if (input.merchantIds) { if (!input.merchantIds.length) return { items: [], total: 0, page, pageSize, metrics: { income: 0, expense: 0, count: 0 } }; where.push(`l.merchant_id IN (${input.merchantIds.map(() => '?').join(',')})`); params.push(...input.merchantIds); }
  if (input.entryType) { where.push("l.entry_type = ?"); params.push(input.entryType); }
  if (input.query) { where.push("(p.code LIKE ? OR p.name LIKE ? OR COALESCE(l.note, '') LIKE ? OR COALESCE(o.platform_order_no, '') LIKE ? OR COALESCE(o.channel_out_trade_no, '') LIKE ?)"); const q = `%${input.query}%`; params.push(q, q, q, q, q); }
  if (input.dateFrom) { where.push("l.created_at >= ?"); params.push(input.dateFrom); }
  if (input.dateTo) { where.push("l.created_at < ?"); params.push(input.dateTo); }
  const clause = ` WHERE ${where.join(" AND ")}`;
  const from = `FROM merchant_ledger_entries l JOIN platform_merchants p ON p.id = l.merchant_id LEFT JOIN orders o ON l.reference_type = 'ORDER' AND l.reference_id = o.id LEFT JOIN channels c ON c.id = o.channel_id`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from}${clause}`).get(...params) as { count: number }).count);
  const items = db.prepare(`SELECT l.id, l.merchant_id AS merchantId, p.code AS merchantCode, p.name AS merchantName,
      l.available_before AS balanceBefore, l.amount, l.available_after AS balanceAfter, l.entry_type AS entryType,
      c.id AS channelId, c.id AS channelName, o.platform_order_no AS businessOrderNo, l.reference_type AS referenceType,
      l.reference_id AS referenceId, l.note, l.created_at AS createdAt
    ${from}${clause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  const metric = db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0) AS expense,
      COUNT(*) AS count ${from}${clause}`).get(...params) as { income: number; expense: number; count: number };
  return { items, total, page, pageSize, metrics: { income: Number(metric.income || 0), expense: Number(metric.expense || 0), count: Number(metric.count || 0) } };
}

export interface MerchantPrepaidSearchInput {
  merchantId?: string;
  merchantIds?: string[];
  entryType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function searchMerchantPrepaidRecords(input: MerchantPrepaidSearchInput = {}): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; summary: Record<string, number> } {
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || 50), 200));
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (input.merchantId) { where.push("l.merchant_id = ?"); params.push(input.merchantId); }
  if (input.merchantIds) { if (!input.merchantIds.length) return { items: [], total: 0, page, pageSize, summary: { totalPrepaid: 0, todayPaid: 0, yesterdayPaid: 0 } }; where.push(`l.merchant_id IN (${input.merchantIds.map(() => '?').join(',')})`); params.push(...input.merchantIds); }
  if (input.entryType) { where.push("l.entry_type = ?"); params.push(input.entryType); }
  if (input.dateFrom) { where.push("l.created_at >= ?"); params.push(input.dateFrom); }
  if (input.dateTo) { where.push("l.created_at < ?"); params.push(input.dateTo); }
  const clause = ` WHERE ${where.join(" AND ")}`;
  const from = `FROM merchant_credit_ledger l JOIN platform_merchants p ON p.id = l.merchant_id`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from}${clause}`).get(...params) as { count: number }).count);
  const items = db.prepare(`SELECT l.id, l.merchant_id AS merchantId, p.code AS merchantCode, p.name AS merchantName,
      l.quota_before AS prepaidBefore, l.amount, l.quota_after AS prepaidAfter, l.entry_type AS entryType,
      CAST(1 AS REAL) AS exchangeRate, NULL AS transferProof, COALESCE(l.reference_id, '') AS operator,
      l.reference_type AS referenceType, l.reference_id AS referenceId, l.note, l.created_at AS createdAt
    ${from}${clause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const accountWhere: string[] = [];
  const accountParams: unknown[] = [];
  if (input.merchantId) { accountWhere.push("a.merchant_id = ?"); accountParams.push(input.merchantId); }
  if (input.merchantIds) { accountWhere.push(`a.merchant_id IN (${input.merchantIds.map(() => '?').join(',')})`); accountParams.push(...input.merchantIds); }
  const totalPrepaid = Number((db.prepare(`SELECT COALESCE(SUM(MAX(0, a.quota_total - a.quota_used)), 0) AS totalPrepaid FROM merchant_accounts a${accountWhere.length ? ` WHERE ${accountWhere.join(' AND ')}` : ''}`).get(...accountParams) as { totalPrepaid: number }).totalPrepaid || 0);
  const summary = db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.amount > 0 AND substr(l.created_at, 1, 10) = ? THEN l.amount ELSE 0 END), 0) AS todayPaid,
      COALESCE(SUM(CASE WHEN l.amount > 0 AND substr(l.created_at, 1, 10) = ? THEN l.amount ELSE 0 END), 0) AS yesterdayPaid
    ${from}${clause}`).get(today, yesterday, ...params) as { todayPaid: number; yesterdayPaid: number };
  return { items, total, page, pageSize, summary: { totalPrepaid, todayPaid: Number(summary.todayPaid || 0), yesterdayPaid: Number(summary.yesterdayPaid || 0) } };
}

export function listMerchantLedgerEntries(merchantId: string, limit = 100): Array<Record<string, unknown>> { ensureMerchantFinancialRecords(merchantId); return db.prepare(`SELECT id, entry_type AS entryType, amount, available_before AS availableBefore, available_after AS availableAfter, pending_before AS pendingBefore, pending_after AS pendingAfter, reference_type AS referenceType, reference_id AS referenceId, note, created_at AS createdAt FROM merchant_ledger_entries WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`).all(merchantId, Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>; }
export function listMerchantAlertEvents(merchantId: string, limit = 100): Array<Record<string, unknown>> { return db.prepare(`SELECT id, alert_type AS alertType, level, metric_value AS metricValue, threshold, status, message, created_at AS createdAt, resolved_at AS resolvedAt FROM merchant_alert_events WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`).all(merchantId, Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>; }

function refreshMerchantAlerts(merchantId: string): void {
  const policy = getMerchantQuotaPolicy(merchantId);
  if (!policy) return;
  const usage = merchantQuotaUsage(merchantId);
  const account = db.prepare("SELECT pending_settlement AS pendingSettlement FROM merchant_accounts WHERE merchant_id = ?").get(merchantId) as { pendingSettlement: number } | undefined;
  const credit = merchantCreditAccount(merchantId);
  const metrics = [
    { type: "DAILY_AMOUNT", value: policy.dailyAmountLimit > 0 ? usage.dailyAmount / policy.dailyAmountLimit : 0, threshold: policy.dailyAmountLimit, message: "今日收款额度接近上限" },
    { type: "PENDING_SETTLEMENT", value: policy.pendingAmountLimit > 0 ? Number(account?.pendingSettlement || 0) / policy.pendingAmountLimit : 0, threshold: policy.pendingAmountLimit, message: "待结算金额接近上限" },
    { type: "CREDIT_BALANCE", value: policy.creditWarningAmount > 0 ? credit.quotaBalance : (credit.quotaTotal > 0 ? credit.quotaUsed / credit.quotaTotal : 0), threshold: policy.creditWarningAmount > 0 ? policy.creditWarningAmount : credit.quotaTotal, message: "码商收款额度余额接近耗尽", absolute: policy.creditWarningAmount > 0 }
  ];
  const now = nowIso();
  for (const metric of metrics) {
    if (metric.threshold <= 0) continue;
    const level = metric.absolute ? (metric.value <= 0 ? "CRITICAL" : metric.value <= metric.threshold ? "WARNING" : undefined) : (metric.value >= policy.criticalRatio ? "CRITICAL" : metric.value >= policy.warningRatio ? "WARNING" : undefined);
    if (level) {
      const open = db.prepare("SELECT id FROM merchant_alert_events WHERE merchant_id = ? AND alert_type = ? AND level = ? AND status = 'OPEN' LIMIT 1").get(merchantId, metric.type, level);
      if (!open) db.prepare("INSERT INTO merchant_alert_events (id, merchant_id, alert_type, level, metric_value, threshold, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)").run(randomId("alert"), merchantId, metric.type, level, metric.value, metric.threshold, `${metric.message}（${metric.absolute ? `余额 ¥${(Number(metric.value) / 100).toFixed(2)}` : `${Math.round(metric.value * 100)}%`}）`, now);
    } else {
      db.prepare("UPDATE merchant_alert_events SET status = 'RESOLVED', resolved_at = ? WHERE merchant_id = ? AND alert_type = ? AND status = 'OPEN'").run(now, merchantId, metric.type);
    }
  }
}

export function touchPlatformMerchantActivity(merchantId: string): void { db.prepare("UPDATE platform_merchants SET last_active_at = ? WHERE id = ?").run(nowIso(), merchantId); }
export function getMerchantUserSession(tokenHash: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT u.id AS userId, u.merchant_id AS merchantId, u.username, u.role, u.must_change_password AS mustChangePassword,
    p.code, p.name, p.status, p.settlement_rate AS settlementRate
    FROM merchant_user_sessions s JOIN merchant_users u ON u.id = s.user_id JOIN platform_merchants p ON p.id = s.merchant_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE' AND p.status = 'ACTIVE'`).get(tokenHash, nowIso()) as Record<string, unknown> | undefined;
}
export function deleteMerchantUserSession(tokenHash: string): void { db.prepare("DELETE FROM merchant_user_sessions WHERE token_hash = ?").run(tokenHash); }
export function markMerchantUserLogin(userId: string): void { db.prepare("UPDATE merchant_users SET last_login_at = ?, must_change_password = 0 WHERE id = ?").run(nowIso(), userId); }
export function updateMerchantUserPassword(userId: string, passwordHash: string): Record<string, unknown> | undefined {
  const user = db.prepare("SELECT id, merchant_id AS merchantId, username, role, status FROM merchant_users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!user) return undefined;
  db.prepare("UPDATE merchant_users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(passwordHash, userId);
  db.prepare("DELETE FROM merchant_user_sessions WHERE user_id = ?").run(userId);
  return user;
}
export function changeMerchantUserPassword(userId: string, passwordHash: string): Record<string, unknown> | undefined {
  const user = db.prepare("SELECT id, merchant_id AS merchantId, username, role, status FROM merchant_users WHERE id = ?").get(userId) as Record<string, unknown> | undefined;
  if (!user || user.status !== "ACTIVE") return undefined;
  db.prepare("UPDATE merchant_users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(passwordHash, userId);
  db.prepare("DELETE FROM merchant_user_sessions WHERE user_id = ?").run(userId);
  return user;
}
export function getMerchantUserByUsername(username: string): (Record<string, unknown> & { passwordHash: string }) | undefined {
  return db.prepare(`SELECT u.id, u.merchant_id AS merchantId, u.username, u.password_hash AS passwordHash, u.role, u.status, u.must_change_password AS mustChangePassword,
    p.code, p.name, p.status AS merchantStatus, p.settlement_rate AS settlementRate
    FROM merchant_users u JOIN platform_merchants p ON p.id = u.merchant_id WHERE u.username = ?`).get(username) as (Record<string, unknown> & { passwordHash: string }) | undefined;
}
export function listPlatformMerchants(): Array<Record<string, unknown>> {
  (db.prepare("SELECT id FROM platform_merchants").all() as Array<{ id: string }>).forEach((row) => ensureMerchantFinancialRecords(String(row.id)));
  return db.prepare(`SELECT p.id, p.code, p.name, p.status, p.settlement_rate AS settlementRate,
    p.max_order_amount AS maxOrderAmount, p.daily_amount_limit AS dailyAmountLimit, p.daily_order_limit AS dailyOrderLimit,
    p.status_reason AS statusReason, p.updated_at AS updatedAt, p.last_active_at AS lastActiveAt, p.created_at AS createdAt,
    (SELECT COUNT(*) FROM platform_merchant_channels pmc WHERE pmc.platform_merchant_id = p.id) AS channelCount,
    (SELECT COUNT(*) FROM platform_merchant_channels pmc JOIN channels c ON c.id = pmc.channel_id WHERE pmc.platform_merchant_id = p.id AND c.status = 'ACTIVE') AS activeChannelCount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id) AS orderCount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND o.status = 'SUCCESS') AS successCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND o.status = 'SUCCESS') AS successAmount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND o.status IN ('FAILED','CLOSED')) AS failureAmount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todayOrderCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours') AND o.status = 'SUCCESS') AS todaySuccessAmount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours') AND o.status = 'SUCCESS') AS todaySuccessCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours') AND o.status IN ('FAILED','CLOSED')) AS todayFailureAmount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours') AND o.status IN ('FAILED','CLOSED')) AS todayFailureCount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')) AS yesterdayOrderCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') AND o.status = 'SUCCESS') AS yesterdaySuccessAmount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') AND o.status = 'SUCCESS') AS yesterdaySuccessCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') AND o.status IN ('FAILED','CLOSED')) AS yesterdayFailureAmount,
    (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = p.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') AND o.status IN ('FAILED','CLOSED')) AS yesterdayFailureCount,
    (SELECT MAX(o.created_at) FROM orders o WHERE o.merchant_id = p.id) AS lastOrderAt,
    (SELECT COUNT(*) FROM settlement_statements s WHERE s.merchant_id = p.id AND s.status IN ('DRAFT','CONFIRMED')) AS pendingSettlementCount,
    COALESCE((SELECT available_balance FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS availableBalance,
    COALESCE((SELECT pending_settlement FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS pendingSettlement,
    COALESCE((SELECT frozen_balance FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS frozenBalance,
    COALESCE((SELECT quota_total FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS quotaTotal,
    COALESCE((SELECT quota_used FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS quotaUsed,
    COALESCE((SELECT quota_total - quota_used FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS quotaBalance,
    COALESCE((SELECT quota_reserved FROM merchant_accounts a WHERE a.merchant_id = p.id), 0) AS quotaReserved,
    COALESCE((SELECT enabled FROM merchant_quota_policies q WHERE q.merchant_id = p.id), 1) AS quotaEnabled,
    COALESCE((SELECT credit_warning_amount FROM merchant_quota_policies q WHERE q.merchant_id = p.id), 0) AS creditWarningAmount,
    (SELECT COUNT(*) FROM merchant_alert_events ae WHERE ae.merchant_id = p.id AND ae.status = 'OPEN') AS openAlertCount,
    (SELECT u.username FROM merchant_users u WHERE u.merchant_id = p.id ORDER BY u.created_at LIMIT 1) AS loginUsername
    FROM platform_merchants p ORDER BY p.created_at DESC`).all() as Array<Record<string, unknown>>;
}
export function getPlatformMerchantDetail(id: string): Record<string, unknown> | undefined {
  const merchant = listPlatformMerchants().find((item) => String(item.id) === id);
  if (!merchant) return undefined;
  const overview = getMerchantOverview(id);
  const channels = listMerchantChannelSettings(id).map((channel) => ({ id: channel.id, subjectName: channel.subjectName, appId: channel.appId, mchId: channel.mchId, status: channel.status, routeWeight: channel.routeWeight, routeStrategy: channel.routeStrategy, enabled: channel.enabled }));
  return { ...merchant, overview, financial: getMerchantFinancialOverview(id), ledger: listMerchantLedgerEntries(id, 20), creditLedger: listMerchantCreditLedger(id, 20), alerts: listMerchantAlertEvents(id, 20), channels };
}
export function updatePlatformMerchantProfile(id: string, input: { name: string; settlementRate: number; maxOrderAmount: number; dailyAmountLimit: number; dailyOrderLimit: number }): Record<string, unknown> | undefined {
  db.prepare("UPDATE platform_merchants SET name = ?, settlement_rate = ?, max_order_amount = ?, daily_amount_limit = ?, daily_order_limit = ?, updated_at = ? WHERE id = ?")
    .run(input.name, input.settlementRate, input.maxOrderAmount, input.dailyAmountLimit, input.dailyOrderLimit, nowIso(), id);
  updateMerchantQuotaPolicy(id, { maxOrderAmount: input.maxOrderAmount, dailyAmountLimit: input.dailyAmountLimit, dailyOrderLimit: input.dailyOrderLimit });
  return listPlatformMerchants().find((item) => String(item.id) === id);
}
export function listMerchantChannelIds(platformMerchantId: string): string[] {
  return db.prepare("SELECT channel_id AS channelId FROM platform_merchant_channels WHERE platform_merchant_id = ? ORDER BY channel_id").all(platformMerchantId).map((row) => String((row as { channelId: string }).channelId));
}
export function listMerchantChannels(platformMerchantId: string): Channel[] {
  const ids = listMerchantChannelIds(platformMerchantId);
  if (!ids.length) return [];
  return listChannels().filter((channel) => ids.includes(channel.id));
}
export function listMerchantChannelSettings(platformMerchantId: string): Array<Record<string, unknown>> {
  return db.prepare(`SELECT c.id, s.name AS subjectName, a.appid AS appId, m.mchid AS mchId, m.credential_ref AS credentialRef, c.status,
    c.route_weight AS defaultRouteWeight, COALESCE(pmcs.enabled, 1) AS enabled,
    COALESCE(pmcs.route_weight, c.route_weight) AS routeWeight,
    COALESCE(c.route_strategy, 'HEALTH_WEIGHTED') AS routeStrategy,
    pmcs.updated_at AS updatedAt
    FROM platform_merchant_channels pmc
    JOIN channels c ON c.id = pmc.channel_id
    JOIN merchant_subjects s ON s.id = c.subject_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = c.merchant_id
    LEFT JOIN platform_merchant_channel_settings pmcs ON pmcs.platform_merchant_id = pmc.platform_merchant_id AND pmcs.channel_id = pmc.channel_id
    WHERE pmc.platform_merchant_id = ? ORDER BY c.id`).all(platformMerchantId) as Array<Record<string, unknown>>;
}
export type MerchantRouteStrategy = "HEALTH_WEIGHTED" | "ROUND_ROBIN" | "FAILOVER";
export function updateMerchantChannelSetting(platformMerchantId: string, channelId: string, input: { enabled?: boolean; routeWeight?: number; routeStrategy?: MerchantRouteStrategy }): Record<string, unknown> | undefined {
  const relation = db.prepare("SELECT 1 FROM platform_merchant_channels WHERE platform_merchant_id = ? AND channel_id = ?").get(platformMerchantId, channelId);
  if (!relation) throw new Error("MERCHANT_CHANNEL_NOT_AUTHORIZED");
  if (input.routeWeight != null && (!Number.isInteger(input.routeWeight) || input.routeWeight < 1 || input.routeWeight > 10000)) throw new Error("INVALID_ROUTE_WEIGHT");
  if (input.routeStrategy != null && !["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"].includes(input.routeStrategy)) throw new Error("INVALID_ROUTE_STRATEGY");
  const current = listMerchantChannelSettings(platformMerchantId).find((item) => String(item.id) === channelId);
  const enabled = input.enabled ?? Boolean(Number(current?.enabled ?? 1));
  const routeWeight = input.routeWeight ?? Number(current?.routeWeight ?? 100);
  const routeStrategy = input.routeStrategy ?? String(current?.routeStrategy || "HEALTH_WEIGHTED");
  const timestamp = nowIso();
  db.prepare(`INSERT INTO platform_merchant_channel_settings (platform_merchant_id, channel_id, enabled, route_weight, route_strategy, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(platform_merchant_id, channel_id) DO UPDATE SET enabled = excluded.enabled, route_weight = excluded.route_weight, route_strategy = excluded.route_strategy, updated_at = excluded.updated_at`)
    .run(platformMerchantId, channelId, enabled ? 1 : 0, routeWeight, routeStrategy, timestamp, timestamp);
  if (input.routeStrategy != null) updateChannelRouteStrategy(channelId, input.routeStrategy);
  return listMerchantChannelSettings(platformMerchantId).find((item) => String(item.id) === channelId);
}
export function getMerchantSubMerchantStats(platformMerchantId: string): Array<Record<string, unknown>> {
  // Scope every metric through the code merchant's authorized channels so a
  // merchant can only see the WeChat merchant IDs it is actually allowed to use.
  const rows = db.prepare(`
    SELECT m.id AS merchantId, m.mchid AS mchId, s.name AS subjectName,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ?
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS orderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS'
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS successOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS'
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS successAmount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND date(o.created_at, '+8 hours') = date('now', '+8 hours')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS todayOrderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS todaySuccessOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS todaySuccessAmount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS yesterdayOrderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS yesterdaySuccessOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS yesterdaySuccessAmount,
      (SELECT COALESCE(SUM(r.refund_amount), 0) FROM refund_orders r JOIN orders o ON o.id = r.order_id JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ? AND r.status = 'SUCCESS'
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS refundAmount,
      (SELECT COUNT(DISTINCT cmb.channel_id) FROM channel_merchant_bindings cmb JOIN platform_merchant_channels pmc3 ON pmc3.channel_id = cmb.channel_id
        WHERE pmc3.platform_merchant_id = ? AND cmb.merchant_id = m.id AND cmb.binding_status = 'ACTIVE') AS channelCount,
      (SELECT MAX(o.created_at) FROM orders o JOIN channels c ON c.id = o.channel_id
        WHERE o.merchant_id = ?
          AND (o.wechat_merchant_id = m.id OR (o.wechat_merchant_id IS NULL AND c.merchant_id = m.id))
          AND EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)) AS lastOrderAt
    FROM wechat_merchants m
    JOIN merchant_subjects s ON s.id = m.subject_id
    WHERE m.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM channel_merchant_bindings cmb JOIN platform_merchant_channels pmc ON pmc.channel_id = cmb.channel_id
        WHERE pmc.platform_merchant_id = ? AND cmb.merchant_id = m.id AND cmb.binding_status = 'ACTIVE')
    ORDER BY successAmount DESC, m.mchid
  `).all(
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId, platformMerchantId,
    platformMerchantId
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const orderCount = Number(row.orderCount || 0);
    const successOrderCount = Number(row.successOrderCount || 0);
    const todayOrderCount = Number(row.todayOrderCount || 0);
    const todaySuccessOrderCount = Number(row.todaySuccessOrderCount || 0);
    const yesterdayOrderCount = Number(row.yesterdayOrderCount || 0);
    const yesterdaySuccessOrderCount = Number(row.yesterdaySuccessOrderCount || 0);
    return {
      ...row,
      orderCount,
      successOrderCount,
      successAmount: Number(row.successAmount || 0),
      successRate: orderCount ? Math.round(successOrderCount * 10000 / orderCount) / 100 : 0,
      todayOrderCount,
      todaySuccessOrderCount,
      todaySuccessAmount: Number(row.todaySuccessAmount || 0),
      todaySuccessRate: todayOrderCount ? Math.round(todaySuccessOrderCount * 10000 / todayOrderCount) / 100 : 0,
      yesterdayOrderCount,
      yesterdaySuccessOrderCount,
      yesterdaySuccessAmount: Number(row.yesterdaySuccessAmount || 0),
      yesterdaySuccessRate: yesterdayOrderCount ? Math.round(yesterdaySuccessOrderCount * 10000 / yesterdayOrderCount) / 100 : 0,
      refundAmount: Number(row.refundAmount || 0),
      channelCount: Number(row.channelCount || 0)
    };
  });
}

export interface ClientMerchantInput {
  id: string;
  code: string;
  name: string;
  loginUsername?: string;
  agentName?: string;
  groupId?: string;
  groupName?: string;
  loginIpAllowlist?: string;
  withdrawIpAllowlist?: string;
  settlementRate?: number;
  profitShare?: number;
  withdrawalFee?: number;
  balanceWarningAmount?: number;
  singleOrderLimit?: number;
  dailyAmountLimit?: number;
  passwordHash?: string;
}
function clientMerchantSelect(): string {
  return `SELECT cm.id, cm.code, cm.name, cm.login_username AS loginUsername, cm.status, cm.agent_name AS agentName,
    cm.two_factor_enabled AS twoFactorEnabled, cm.password_updated_at AS passwordUpdatedAt,
    cm.group_id AS groupId, cm.group_name AS groupName, cm.login_ip_allowlist AS loginIpAllowlist, cm.withdraw_ip_allowlist AS withdrawIpAllowlist,
    cm.settlement_rate AS settlementRate, cm.profit_share AS profitShare, cm.balance, cm.frozen_amount AS frozenAmount,
    cm.prepaid_amount AS prepaidAmount, cm.settlement_amount AS settlementAmount, cm.withdrawal_fee AS withdrawalFee, cm.withdrawable_amount AS withdrawableAmount,
    cm.total_received AS totalReceived, cm.total_refunded AS totalRefunded, cm.total_settled AS totalSettled,
    cm.balance_warning_amount AS balanceWarningAmount, cm.single_order_limit AS singleOrderLimit, cm.daily_amount_limit AS dailyAmountLimit,
    cm.created_at AS createdAt, cm.updated_at AS updatedAt,
    (SELECT COUNT(*) FROM orders o WHERE o.client_merchant_id = cm.id) AS orderCount,
    (SELECT COUNT(*) FROM orders o WHERE o.client_merchant_id = cm.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todaySuccessCount,
    (SELECT COUNT(*) FROM orders o WHERE o.client_merchant_id = cm.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todayOrderCount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.client_merchant_id = cm.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todaySuccessAmount,
    (SELECT COALESCE(SUM(o.amount), 0) FROM orders o WHERE o.client_merchant_id = cm.id AND o.status = 'SUCCESS') AS successAmount,
    (SELECT COALESCE(SUM(r.refund_amount), 0) FROM refund_orders r JOIN orders o ON o.id = r.order_id WHERE o.client_merchant_id = cm.id AND r.status = 'SUCCESS') AS refundAmount,
    (SELECT COUNT(*) FROM client_merchant_code_merchants x WHERE x.client_merchant_id = cm.id AND x.status = 'ACTIVE') AS codeMerchantCount,
    (SELECT COUNT(*) FROM client_merchant_channels x WHERE x.client_merchant_id = cm.id AND x.status = 'ACTIVE') AS channelCount
    FROM client_merchants cm`;
}
export function listClientMerchants(input: { query?: string; status?: string } = {}): Array<Record<string, unknown>> {
  const where: string[] = []; const params: unknown[] = [];
  if (input.query) { where.push('(cm.code LIKE ? OR cm.name LIKE ? OR COALESCE(cm.login_username, \'\') LIKE ? OR COALESCE(cm.agent_name, \'\') LIKE ?)'); const q = `%${input.query}%`; params.push(q, q, q, q); }
  if (input.status) { where.push('cm.status = ?'); params.push(input.status); }
  const rows = db.prepare(`${clientMerchantSelect()}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY cm.created_at DESC`).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => { const total = Number(row.todayOrderCount || 0); const success = Number(row.todaySuccessCount || 0); return { ...row, balance: Number(row.balance || 0), frozenAmount: Number(row.frozenAmount || 0), prepaidAmount: Number(row.prepaidAmount || 0), settlementAmount: Number(row.settlementAmount || 0), withdrawableAmount: Number(row.withdrawableAmount ?? row.balance ?? 0), totalReceived: Number(row.totalReceived || 0), totalRefunded: Number(row.totalRefunded || 0), totalSettled: Number(row.totalSettled || 0), withdrawalFee: Number(row.withdrawalFee || 0), balanceWarningAmount: Number(row.balanceWarningAmount || 0), singleOrderLimit: Number(row.singleOrderLimit || 0), dailyAmountLimit: Number(row.dailyAmountLimit || 0), orderCount: Number(row.orderCount || 0), todayOrderCount: total, todaySuccessCount: success, todaySuccessAmount: Number(row.todaySuccessAmount || 0), successAmount: Number(row.successAmount || 0), refundAmount: Number(row.refundAmount || 0), codeMerchantCount: Number(row.codeMerchantCount || 0), channelCount: Number(row.channelCount || 0), todaySuccessRate: total ? Math.round(success * 10000 / total) / 100 : 0 }; });
}
function normalizeClientMerchantRow(row: Record<string, unknown>): Record<string, unknown> { const total = Number(row.todayOrderCount || 0); const success = Number(row.todaySuccessCount || 0); return { ...row, balance: Number(row.balance || 0), frozenAmount: Number(row.frozenAmount || 0), prepaidAmount: Number(row.prepaidAmount || 0), settlementAmount: Number(row.settlementAmount || 0), withdrawableAmount: Number(row.withdrawableAmount ?? row.balance ?? 0), totalReceived: Number(row.totalReceived || 0), totalRefunded: Number(row.totalRefunded || 0), totalSettled: Number(row.totalSettled || 0), settlementRate: Number(row.settlementRate || 0), profitShare: Number(row.profitShare || 0), withdrawalFee: Number(row.withdrawalFee || 0), balanceWarningAmount: Number(row.balanceWarningAmount || 0), singleOrderLimit: Number(row.singleOrderLimit || 0), dailyAmountLimit: Number(row.dailyAmountLimit || 0), orderCount: Number(row.orderCount || 0), todayOrderCount: total, todaySuccessCount: success, todaySuccessAmount: Number(row.todaySuccessAmount || 0), successAmount: Number(row.successAmount || 0), refundAmount: Number(row.refundAmount || 0), codeMerchantCount: Number(row.codeMerchantCount || 0), channelCount: Number(row.channelCount || 0), todaySuccessRate: total ? Math.round(success * 10000 / total) / 100 : 0 }; }
export function getClientMerchant(id: string): Record<string, unknown> | undefined { const row = db.prepare(`${clientMerchantSelect()} WHERE cm.id = ?`).get(id) as Record<string, unknown> | undefined; return row ? normalizeClientMerchantRow(row) : undefined; }
function normalizeIpAllowlist(value?: string | null): string {
  return [...new Set(String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean))].slice(0, 100).join('|');
}
export function createClientMerchant(input: ClientMerchantInput): Record<string, unknown> {
  const now = nowIso();
  const apiKey = crypto.randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO client_merchants (id, code, name, login_username, api_key_hash, password_hash, password_updated_at, status, agent_name, group_id, group_name, login_ip_allowlist, withdraw_ip_allowlist, settlement_rate, profit_share, withdrawal_fee, balance_warning_amount, single_order_limit, daily_amount_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.code, input.name, input.loginUsername ?? null, apiKeyHash(apiKey), input.passwordHash ?? null, input.passwordHash ? now : null, input.agentName ?? null, input.groupId ?? '0', input.groupName ?? null, normalizeIpAllowlist(input.loginIpAllowlist), normalizeIpAllowlist(input.withdrawIpAllowlist), input.settlementRate ?? 0, input.profitShare ?? 0, input.withdrawalFee ?? 0, input.balanceWarningAmount ?? 0, input.singleOrderLimit ?? 0, input.dailyAmountLimit ?? 0, now, now);
  return { ...getClientMerchant(input.id)!, apiKey };
}
export function rotateClientMerchantApiKey(id: string): Record<string, unknown> | undefined {
  if (!getClientMerchant(id)) return undefined;
  const apiKey = crypto.randomBytes(32).toString("base64url");
  db.prepare("UPDATE client_merchants SET api_key_hash = ?, updated_at = ? WHERE id = ?").run(apiKeyHash(apiKey), nowIso(), id);
  return { ...getClientMerchant(id)!, apiKey };
}
export function authenticateClientMerchant(apiKey: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT id, code, name, status, settlement_rate AS settlementRate, login_ip_allowlist AS loginIpAllowlist, withdraw_ip_allowlist AS withdrawIpAllowlist FROM client_merchants WHERE api_key_hash = ? AND status = 'ACTIVE'").get(apiKeyHash(apiKey)) as Record<string, unknown> | undefined;
}
export function getClientMerchantByUsername(username: string): (Record<string, unknown> & { passwordHash?: string; twoFactorSecret?: string; twoFactorEnabled?: number; failedLoginAttempts?: number; lockedUntil?: string | null }) | undefined {
  return db.prepare("SELECT id, code, name, status, password_hash AS passwordHash, two_factor_secret AS twoFactorSecret, two_factor_enabled AS twoFactorEnabled, failed_login_attempts AS failedLoginAttempts, locked_until AS lockedUntil, login_ip_allowlist AS loginIpAllowlist FROM client_merchants WHERE login_username = ?").get(username) as (Record<string, unknown> & { passwordHash?: string; twoFactorSecret?: string; twoFactorEnabled?: number; failedLoginAttempts?: number; lockedUntil?: string | null }) | undefined;
}
export function recordClientMerchantLoginFailure(id: string): void {
  db.prepare("UPDATE client_merchants SET failed_login_attempts = failed_login_attempts + 1, locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN ? ELSE locked_until END WHERE id = ?").run(new Date(Date.now() + 15 * 60 * 1000).toISOString(), id);
}
export function resetClientMerchantLoginFailures(id: string): void { db.prepare("UPDATE client_merchants SET failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id); }
export function updateClientMerchantPassword(id: string, passwordHash: string): void { db.prepare("UPDATE client_merchants SET password_hash = ?, password_updated_at = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?").run(passwordHash, nowIso(), nowIso(), id); }
export function setClientMerchantTwoFactor(id: string, secret: string, enabled: boolean): Record<string, unknown> | undefined { db.prepare("UPDATE client_merchants SET two_factor_secret = ?, two_factor_enabled = ?, updated_at = ? WHERE id = ?").run(secret, enabled ? 1 : 0, nowIso(), id); return getClientMerchant(id); }
export function createClientMerchantSession(clientMerchantId: string, tokenHash: string, expiresAt: string): void { db.prepare("INSERT INTO client_merchant_sessions (token_hash, client_merchant_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, clientMerchantId, expiresAt, nowIso()); }
export function getClientMerchantFromSession(tokenHash: string): Record<string, unknown> | undefined { return db.prepare("SELECT cm.id, cm.code, cm.name, cm.status, cm.login_ip_allowlist AS loginIpAllowlist FROM client_merchant_sessions s JOIN client_merchants cm ON cm.id = s.client_merchant_id WHERE s.token_hash = ? AND s.expires_at > ? AND cm.status = 'ACTIVE'").get(tokenHash, nowIso()) as Record<string, unknown> | undefined; }
export function deleteClientMerchantSession(tokenHash: string | undefined): void { if (tokenHash) db.prepare("DELETE FROM client_merchant_sessions WHERE token_hash = ?").run(tokenHash); }
export function listMerchantAgents(): Array<Record<string, unknown>> { return db.prepare("SELECT id, name, status, created_at AS createdAt, updated_at AS updatedAt FROM merchant_agents WHERE status = 'ACTIVE' ORDER BY name").all() as Array<Record<string, unknown>>; }
export function listMerchantGroups(): Array<Record<string, unknown>> { return db.prepare("SELECT id, name, status, created_at AS createdAt, updated_at AS updatedAt FROM merchant_groups WHERE status = 'ACTIVE' ORDER BY name").all() as Array<Record<string, unknown>>; }
export function createMerchantAgent(name: string): Record<string, unknown> { const id = randomId('agent'); const now = nowIso(); db.prepare("INSERT INTO merchant_agents (id, name, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)").run(id, name, now, now); return { id, name, status: 'ACTIVE', createdAt: now, updatedAt: now }; }
export function createMerchantGroup(name: string): Record<string, unknown> { const id = randomId('group'); const now = nowIso(); db.prepare("INSERT INTO merchant_groups (id, name, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)").run(id, name, now, now); return { id, name, status: 'ACTIVE', createdAt: now, updatedAt: now }; }
export function updateClientMerchant(id: string, input: Partial<Omit<ClientMerchantInput, 'id'>> & { status?: string }): Record<string, unknown> | undefined {
  const current = getClientMerchant(id); if (!current) return undefined;
  db.prepare(`UPDATE client_merchants SET code = COALESCE(?, code), name = COALESCE(?, name), login_username = COALESCE(?, login_username), agent_name = COALESCE(?, agent_name), group_id = COALESCE(?, group_id), group_name = COALESCE(?, group_name), login_ip_allowlist = COALESCE(?, login_ip_allowlist), withdraw_ip_allowlist = COALESCE(?, withdraw_ip_allowlist), settlement_rate = COALESCE(?, settlement_rate), profit_share = COALESCE(?, profit_share), withdrawal_fee = COALESCE(?, withdrawal_fee), balance_warning_amount = COALESCE(?, balance_warning_amount), single_order_limit = COALESCE(?, single_order_limit), daily_amount_limit = COALESCE(?, daily_amount_limit), status = COALESCE(?, status), updated_at = ? WHERE id = ?`)
    .run(input.code ?? null, input.name ?? null, input.loginUsername ?? null, input.agentName ?? null, input.groupId ?? null, input.groupName ?? null, input.loginIpAllowlist === undefined ? null : normalizeIpAllowlist(input.loginIpAllowlist), input.withdrawIpAllowlist === undefined ? null : normalizeIpAllowlist(input.withdrawIpAllowlist), input.settlementRate ?? null, input.profitShare ?? null, input.withdrawalFee ?? null, input.balanceWarningAmount ?? null, input.singleOrderLimit ?? null, input.dailyAmountLimit ?? null, input.status ?? null, nowIso(), id);
  return getClientMerchant(id);
}
export function checkClientMerchantOrderRisk(id: string, amount: number): { allowed: boolean; reason?: string; dailyAmount: number; dailyAmountLimit: number; singleOrderLimit: number; balanceWarning: boolean } {
  const merchant = db.prepare('SELECT balance, balance_warning_amount AS balanceWarningAmount, single_order_limit AS singleOrderLimit, daily_amount_limit AS dailyAmountLimit FROM client_merchants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!merchant) return { allowed: false, reason: 'CLIENT_MERCHANT_NOT_AVAILABLE', dailyAmount: 0, dailyAmountLimit: 0, singleOrderLimit: 0, balanceWarning: false };
  const singleOrderLimit = Number(merchant.singleOrderLimit || 0); const dailyAmountLimit = Number(merchant.dailyAmountLimit || 0);
  const daily = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM orders WHERE client_merchant_id = ? AND status NOT IN ('FAILED', 'CLOSED', 'REFUNDED') AND date(created_at, '+8 hours') = date('now', '+8 hours')").get(id) as { total: number };
  const dailyAmount = Number(daily?.total || 0); const balanceWarning = Number(merchant.balance || 0) <= Number(merchant.balanceWarningAmount || 0) && Number(merchant.balanceWarningAmount || 0) > 0;
  if (singleOrderLimit > 0 && amount > singleOrderLimit) return { allowed: false, reason: 'CLIENT_MERCHANT_SINGLE_LIMIT_EXCEEDED', dailyAmount, dailyAmountLimit, singleOrderLimit, balanceWarning };
  if (dailyAmountLimit > 0 && dailyAmount + amount > dailyAmountLimit) return { allowed: false, reason: 'CLIENT_MERCHANT_DAILY_LIMIT_EXCEEDED', dailyAmount, dailyAmountLimit, singleOrderLimit, balanceWarning };
  return { allowed: true, dailyAmount, dailyAmountLimit, singleOrderLimit, balanceWarning };
}
export function appendClientMerchantLedger(input: { clientMerchantId: string; entryType: string; amount: number; availableDelta?: number; pendingDelta?: number; frozenDelta?: number; referenceType?: string; referenceId?: string; idempotencyKey: string; note?: string; operator?: string }): Record<string, unknown> {
  const existing = db.prepare("SELECT * FROM client_merchant_ledger WHERE idempotency_key = ?").get(input.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) return existing;
  const tx = db.transaction(() => {
    const account = db.prepare("SELECT balance, frozen_amount AS frozenAmount, settlement_amount AS pendingAmount FROM client_merchants WHERE id = ?").get(input.clientMerchantId) as { balance: number; frozenAmount: number; pendingAmount: number } | undefined;
    if (!account) throw new Error('CLIENT_MERCHANT_NOT_FOUND');
    const availableBefore = Number(account.balance || 0); const pendingBefore = Number(account.pendingAmount || 0); const frozenBefore = Number(account.frozenAmount || 0);
    const availableAfter = availableBefore + Number(input.availableDelta || 0); const pendingAfter = pendingBefore + Number(input.pendingDelta || 0); const frozenAfter = frozenBefore + Number(input.frozenDelta || 0);
    if (availableAfter < 0 || pendingAfter < 0 || frozenAfter < 0) throw new Error('CLIENT_MERCHANT_BALANCE_INSUFFICIENT');
    const now = nowIso(); const id = randomId('cledger');
    db.prepare(`INSERT INTO client_merchant_ledger (id, client_merchant_id, entry_type, amount, balance_before, balance_after, available_before, available_after, pending_before, pending_after, frozen_before, frozen_after, reference_type, reference_id, idempotency_key, note, operator, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.clientMerchantId, input.entryType, input.amount, availableBefore, availableAfter, availableBefore, availableAfter, pendingBefore, pendingAfter, frozenBefore, frozenAfter, input.referenceType ?? null, input.referenceId ?? null, input.idempotencyKey, input.note ?? null, input.operator ?? 'system', now);
    db.prepare(`UPDATE client_merchants SET balance = ?, frozen_amount = ?, settlement_amount = ?, withdrawable_amount = MAX(0, ? - ? - ?), total_received = total_received + ?, total_refunded = total_refunded + ?, total_settled = total_settled + ?, updated_at = ? WHERE id = ?`).run(availableAfter, frozenAfter, pendingAfter, availableAfter, frozenAfter, pendingAfter, input.entryType === 'ORDER_SUCCESS' ? Math.abs(input.amount) : 0, input.entryType === 'REFUND_SUCCESS' ? Math.abs(input.amount) : 0, input.entryType === 'SETTLEMENT_PAID' ? Math.abs(input.amount) : 0, now, input.clientMerchantId);
    return db.prepare("SELECT * FROM client_merchant_ledger WHERE id = ?").get(id) as Record<string, unknown>;
  });
  return tx() as Record<string, unknown>;
}
export function recordClientMerchantOrderSuccess(clientMerchantId: string, orderId: string, amount: number): void { appendClientMerchantLedger({ clientMerchantId, entryType: 'ORDER_SUCCESS', amount, availableDelta: amount, referenceType: 'ORDER', referenceId: orderId, idempotencyKey: `client-order:${orderId}:success`, note: '订单支付成功' }); }
export function recordClientMerchantRefundSuccess(clientMerchantId: string, refundNo: string, amount: number): void { appendClientMerchantLedger({ clientMerchantId, entryType: 'REFUND_SUCCESS', amount: -Math.abs(amount), availableDelta: -Math.abs(amount), referenceType: 'REFUND', referenceId: refundNo, idempotencyKey: `client-refund:${refundNo}:success`, note: '退款成功' }); }
export function adjustClientMerchantBalance(id: string, amount: number, entryType: 'ADJUST_ADD' | 'ADJUST_SUBTRACT', note?: string, operator?: string): Record<string, unknown> | undefined {
  if (!getClientMerchant(id)) return undefined;
  appendClientMerchantLedger({ clientMerchantId: id, entryType, amount: entryType === 'ADJUST_ADD' ? amount : -amount, availableDelta: entryType === 'ADJUST_ADD' ? amount : -amount, referenceType: 'ADMIN', referenceId: id, idempotencyKey: `client-adjust:${id}:${entryType}:${randomId('op')}`, note: note ?? '后台人工调整余额', operator });
  return getClientMerchant(id);
}
export function listClientMerchantLedger(id: string, limit = 100): Array<Record<string, unknown>> { return db.prepare('SELECT id, entry_type AS entryType, amount, balance_before AS balanceBefore, balance_after AS balanceAfter, available_before AS availableBefore, available_after AS availableAfter, pending_before AS pendingBefore, pending_after AS pendingAfter, frozen_before AS frozenBefore, frozen_after AS frozenAfter, reference_type AS referenceType, reference_id AS referenceId, note, operator, created_at AS createdAt FROM client_merchant_ledger WHERE client_merchant_id = ? ORDER BY created_at DESC LIMIT ?').all(id, Math.max(1, Math.min(limit, 500))) as Array<Record<string, unknown>>; }
export function setClientMerchantCodeMerchants(id: string, platformMerchantIds: string[]): Array<Record<string, unknown>> {
  if (!getClientMerchant(id)) throw new Error('CLIENT_MERCHANT_NOT_FOUND');
  const unique = [...new Set(platformMerchantIds)]; const tx = db.transaction(() => { db.prepare('DELETE FROM client_merchant_code_merchants WHERE client_merchant_id = ?').run(id); const insert = db.prepare("INSERT INTO client_merchant_code_merchants (client_merchant_id, platform_merchant_id, status, created_at) VALUES (?, ?, 'ACTIVE', ?)"); for (const codeMerchantId of unique) { if (!db.prepare('SELECT id FROM platform_merchants WHERE id = ?').get(codeMerchantId)) throw new Error('PLATFORM_MERCHANT_NOT_FOUND'); insert.run(id, codeMerchantId, nowIso()); } }); tx(); return listClientMerchantCodeMerchants(id);
}
export function listClientMerchantCodeMerchants(id: string): Array<Record<string, unknown>> { return db.prepare(`SELECT p.id, p.code, p.name, p.status, x.status AS relationStatus, x.created_at AS createdAt FROM client_merchant_code_merchants x JOIN platform_merchants p ON p.id = x.platform_merchant_id WHERE x.client_merchant_id = ? ORDER BY p.name`).all(id) as Array<Record<string, unknown>>; }
export function setClientMerchantChannels(id: string, channelIds: string[], routeStrategies: Record<string, MerchantRouteStrategy> = {}): Array<Record<string, unknown>> {
  if (!getClientMerchant(id)) throw new Error('CLIENT_MERCHANT_NOT_FOUND');
  const unique = [...new Set(channelIds)]; const tx = db.transaction(() => { db.prepare('DELETE FROM client_merchant_channels WHERE client_merchant_id = ?').run(id); const insert = db.prepare("INSERT INTO client_merchant_channels (client_merchant_id, channel_id, status, route_strategy, created_at) VALUES (?, ?, 'ACTIVE', ?, ?)"); for (const channelId of unique) { if (!db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId)) throw new Error('CHANNEL_NOT_FOUND'); const strategy = routeStrategies[channelId] || 'HEALTH_WEIGHTED'; if (!["HEALTH_WEIGHTED", "ROUND_ROBIN", "FAILOVER"].includes(strategy)) throw new Error('INVALID_ROUTE_STRATEGY'); insert.run(id, channelId, strategy, nowIso()); } }); tx(); return listClientMerchantChannels(id);
}

/** Resources visible to a code merchant. Every query is scoped through the
 * platform_merchant_channels -> channel_merchant_bindings relation so the
 * portal can never enumerate unrelated WeChat accounts. */
export function listPlatformMerchantWechatMerchants(platformMerchantId: string): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT DISTINCT m.id, m.mchid, m.credential_ref AS credentialRef, m.status, m.subject_id AS subjectId,
      s.name AS subjectName, m.daily_amount_limit AS dailyAmountLimit,
      m.complaint_count AS complaintCount, m.risk_enabled AS riskEnabled,
      m.monitor_locked AS monitorLocked, m.monitor_lock_reason AS monitorLockReason,
      COUNT(DISTINCT cmb.channel_id) AS channelCount
    FROM platform_merchant_channels pmc
    JOIN channel_merchant_bindings cmb ON cmb.channel_id = pmc.channel_id AND cmb.binding_status = 'ACTIVE'
    JOIN wechat_merchants m ON m.id = cmb.merchant_id
    JOIN merchant_subjects s ON s.id = m.subject_id
    WHERE pmc.platform_merchant_id = ?
    GROUP BY m.id
    ORDER BY m.mchid
  `).all(platformMerchantId) as Array<Record<string, unknown>>;
}

export function listPlatformMerchantSubjects(platformMerchantId: string): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT DISTINCT s.id, s.name, s.subject_type AS subjectType,
      (SELECT COUNT(*) FROM wechat_apps a WHERE a.subject_id = s.id) AS appCount,
      (SELECT COUNT(*) FROM wechat_merchants m WHERE m.subject_id = s.id) AS merchantCount,
      (SELECT COUNT(*) FROM channels c WHERE c.subject_id = s.id) AS channelCount
    FROM platform_merchant_channels pmc
    JOIN channels c ON c.id = pmc.channel_id
    JOIN merchant_subjects s ON s.id = c.subject_id
    WHERE pmc.platform_merchant_id = ? ORDER BY s.name
  `).all(platformMerchantId) as Array<Record<string, unknown>>;
}

export function listPlatformMerchantApps(platformMerchantId: string): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT DISTINCT a.id, a.appid, a.app_type AS appType, a.status,
      a.subject_id AS subjectId, s.name AS subjectName,
      (SELECT COUNT(*) FROM app_mch_bindings b WHERE b.app_id = a.id) AS bindingCount
    FROM platform_merchant_channels pmc
    JOIN channels c ON c.id = pmc.channel_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN merchant_subjects s ON s.id = a.subject_id
    WHERE pmc.platform_merchant_id = ? ORDER BY a.appid
  `).all(platformMerchantId) as Array<Record<string, unknown>>;
}

export function isPlatformMerchantChannelAuthorized(platformMerchantId: string, channelId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM platform_merchant_channels WHERE platform_merchant_id = ? AND channel_id = ?").get(platformMerchantId, channelId));
}
export function listClientMerchantChannels(id: string): Array<Record<string, unknown>> { return db.prepare(`SELECT c.id, c.id AS channelId, c.status, c.route_weight AS routeWeight, COALESCE(x.route_strategy, 'HEALTH_WEIGHTED') AS routeStrategy, s.name AS subjectName, a.appid AS appId, m.mchid AS mchId, x.status AS relationStatus, x.created_at AS createdAt FROM client_merchant_channels x JOIN channels c ON c.id = x.channel_id JOIN merchant_subjects s ON s.id = c.subject_id JOIN wechat_apps a ON a.id = c.app_id JOIN wechat_merchants m ON m.id = c.merchant_id WHERE x.client_merchant_id = ? ORDER BY c.id`).all(id) as Array<Record<string, unknown>>; }

export interface MerchantSubMerchantOrderSearchInput {
  page?: number; pageSize?: number; status?: string; query?: string; dateFrom?: string; dateTo?: string;
}
export function listMerchantSubMerchantOrders(platformMerchantId: string, wechatMerchantId: string, input: MerchantSubMerchantOrderSearchInput = {}): { merchant: Record<string, unknown>; items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number } | undefined {
  const merchant = db.prepare(`SELECT m.id AS merchantId, m.mchid AS mchId, s.name AS subjectName
    FROM wechat_merchants m JOIN merchant_subjects s ON s.id = m.subject_id
    WHERE m.id = ? AND m.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM channel_merchant_bindings cmb JOIN platform_merchant_channels pmc ON pmc.channel_id = cmb.channel_id
        WHERE pmc.platform_merchant_id = ? AND cmb.merchant_id = m.id AND cmb.binding_status = 'ACTIVE')`).get(wechatMerchantId, platformMerchantId) as Record<string, unknown> | undefined;
  if (!merchant) return undefined;
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(1, Math.min(Number(input.pageSize || 50), 200));
  const where: string[] = ["o.merchant_id = ?", "(o.wechat_merchant_id = ? OR (o.wechat_merchant_id IS NULL AND c.merchant_id = ?))", "EXISTS (SELECT 1 FROM platform_merchant_channels pmc2 WHERE pmc2.platform_merchant_id = ? AND pmc2.channel_id = o.channel_id)"];
  const params: unknown[] = [platformMerchantId, wechatMerchantId, wechatMerchantId, platformMerchantId];
  if (input.status) { where.push("o.status = ?"); params.push(input.status); }
  if (input.query) { where.push("(o.platform_order_no LIKE ? OR o.channel_out_trade_no LIKE ? OR o.client_request_no LIKE ? OR COALESCE(o.transaction_id, '') LIKE ?)"); const q = `%${input.query}%`; params.push(q, q, q, q); }
  if (input.dateFrom) { where.push("o.created_at >= ?"); params.push(input.dateFrom); }
  if (input.dateTo) { where.push("o.created_at < ?"); params.push(input.dateTo); }
  const from = `FROM orders o JOIN channels c ON c.id = o.channel_id JOIN wechat_apps a ON a.id = c.app_id`;
  const clause = ` WHERE ${where.join(" AND ")}`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from}${clause}`).get(...params) as { count: number }).count);
  const items = db.prepare(`SELECT o.id, o.platform_order_no AS platformOrderNo, o.channel_out_trade_no AS channelOutTradeNo,
    o.client_request_no AS clientRequestNo, o.amount, o.description, o.status, o.transaction_id AS transactionId,
    o.expire_at AS expireAt, o.created_at AS createdAt, o.paid_at AS paidAt, o.channel_id AS channelId,
    o.user_id AS userId, o.payment_openid_hash AS paymentOpenidHash, o.device_type AS deviceType, o.device_ip AS deviceIp, o.device_country AS deviceCountry, o.device_province AS deviceProvince, o.device_city AS deviceCity, o.device_no AS deviceNo,
    a.appid AS appId FROM ${from.slice(5)}${clause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  return { merchant, items, total, page, pageSize };
}

export function getMerchantChannelStats(platformMerchantId: string): Array<Record<string, unknown>> {
  const rows = db.prepare(`SELECT c.id AS channelId, c.notify_path AS notifyPath, c.status,
      COALESCE(pmcs.enabled, 1) AS enabled, COALESCE(pmcs.route_weight, c.route_weight) AS routeWeight,
      (SELECT COUNT(*) FROM channel_merchant_bindings cmb WHERE cmb.channel_id = c.id AND cmb.binding_status = 'ACTIVE') AS merchantCount,
      COUNT(o.id) AS orderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS successAmount,
      SUM(CASE WHEN date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todayOrderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todaySuccessOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN o.amount ELSE 0 END), 0) AS todaySuccessAmount,
      COALESCE((SELECT SUM(r.refund_amount) FROM refund_orders r JOIN orders ro ON ro.id = r.order_id WHERE ro.channel_id = c.id AND ro.merchant_id = ? AND r.status = 'SUCCESS'), 0) AS refundAmount,
      MAX(o.created_at) AS lastOrderAt
    FROM platform_merchant_channels pmc JOIN channels c ON c.id = pmc.channel_id
    LEFT JOIN platform_merchant_channel_settings pmcs ON pmcs.platform_merchant_id = pmc.platform_merchant_id AND pmcs.channel_id = c.id
    LEFT JOIN orders o ON o.channel_id = c.id AND o.merchant_id = pmc.platform_merchant_id
    WHERE pmc.platform_merchant_id = ? GROUP BY c.id, c.notify_path, c.status, pmcs.enabled, pmcs.route_weight, c.route_weight ORDER BY successAmount DESC, c.id`).all(platformMerchantId, platformMerchantId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const orderCount = Number(row.orderCount || 0); const successOrderCount = Number(row.successOrderCount || 0);
    const todayOrderCount = Number(row.todayOrderCount || 0); const todaySuccessOrderCount = Number(row.todaySuccessOrderCount || 0);
    return { ...row, enabled: Number(row.enabled || 0), merchantCount: Number(row.merchantCount || 0), orderCount, successOrderCount, successAmount: Number(row.successAmount || 0), successRate: orderCount ? Math.round(successOrderCount * 10000 / orderCount) / 100 : 0, todayOrderCount, todaySuccessOrderCount, todaySuccessAmount: Number(row.todaySuccessAmount || 0), todaySuccessRate: todayOrderCount ? Math.round(todaySuccessOrderCount * 10000 / todayOrderCount) / 100 : 0, refundAmount: Number(row.refundAmount || 0) };
  });
}
export function setMerchantChannels(platformMerchantId: string, channelIds: string[]): Channel[] {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(platformMerchantId)) throw new Error("PLATFORM_MERCHANT_NOT_FOUND");
  const uniqueIds = [...new Set(channelIds)];
  const placeholders = uniqueIds.map(() => "?").join(",");
  if (uniqueIds.length && Number((db.prepare(`SELECT COUNT(*) AS count FROM channels WHERE id IN (${placeholders})`).get(...uniqueIds) as { count: number }).count) !== uniqueIds.length) throw new Error("CHANNEL_NOT_FOUND");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM platform_merchant_channels WHERE platform_merchant_id = ?").run(platformMerchantId);
    const insert = db.prepare("INSERT INTO platform_merchant_channels (platform_merchant_id, channel_id, created_at) VALUES (?, ?, ?)");
    for (const channelId of uniqueIds) insert.run(platformMerchantId, channelId, nowIso());
  });
  tx();
  return listMerchantChannels(platformMerchantId);
}
export function setPlatformMerchantStatus(id: string, status: "PENDING" | "ACTIVE" | "SUSPENDED" | "FROZEN" | "DISABLED" | "ARCHIVED", reason?: string): void { db.prepare("UPDATE platform_merchants SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?").run(status, reason ?? null, nowIso(), id); }
export function authenticatePlatformMerchant(apiKey: string): Record<string, unknown> | undefined { return db.prepare("SELECT id, code, name, status, settlement_rate AS settlementRate, max_order_amount AS maxOrderAmount, daily_amount_limit AS dailyAmountLimit, daily_order_limit AS dailyOrderLimit FROM platform_merchants WHERE api_key_hash = ? AND status = 'ACTIVE'").get(apiKeyHash(apiKey)) as Record<string, unknown> | undefined; }
export function updateMerchantRiskPolicy(id: string, input: { maxOrderAmount: number; dailyAmountLimit: number; dailyOrderLimit: number }): Record<string, unknown> | undefined {
  db.prepare("UPDATE platform_merchants SET max_order_amount = ?, daily_amount_limit = ?, daily_order_limit = ? WHERE id = ?").run(input.maxOrderAmount, input.dailyAmountLimit, input.dailyOrderLimit, id);
  updateMerchantQuotaPolicy(id, input);
  return listPlatformMerchants().find((item) => String(item.id) === id);
}
export function rotatePlatformMerchantApiKey(id: string): Record<string, unknown> & { apiKey: string } | undefined {
  const current = db.prepare("SELECT id, code, name, status, settlement_rate AS settlementRate, created_at AS createdAt FROM platform_merchants WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) return undefined;
  const apiKey = `cm_${crypto.randomBytes(24).toString("base64url")}`;
  db.prepare("UPDATE platform_merchants SET api_key_hash = ? WHERE id = ?").run(apiKeyHash(apiKey), id);
  db.prepare("DELETE FROM merchant_sessions WHERE merchant_id = ?").run(id);
  return { ...current, apiKey };
}
export function createMerchantSession(merchantId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO merchant_sessions (token_hash, merchant_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(apiKeyHash(token), merchantId, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), nowIso());
  db.prepare("UPDATE platform_merchants SET last_active_at = ?, updated_at = updated_at WHERE id = ?").run(nowIso(), merchantId);
  return token;
}
export function getMerchantFromSession(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const merchant = db.prepare(`SELECT p.id, p.code, p.name, p.status, p.settlement_rate AS settlementRate
    FROM merchant_sessions s JOIN platform_merchants p ON p.id = s.merchant_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND p.status = 'ACTIVE'`).get(apiKeyHash(token), nowIso()) as Record<string, unknown> | undefined;
  if (merchant) db.prepare("UPDATE platform_merchants SET last_active_at = ? WHERE id = ?").run(nowIso(), merchant.id);
  return merchant;
}
export function deleteMerchantSession(token: string | undefined): void { if (token) db.prepare("DELETE FROM merchant_sessions WHERE token_hash = ?").run(apiKeyHash(token)); }
export function consumeMerchantRequestNonce(merchantId: string, nonce: string, expiresAt: string): boolean {
  db.prepare("DELETE FROM merchant_request_nonces WHERE expires_at <= ?").run(nowIso());
  try { db.prepare("INSERT INTO merchant_request_nonces (merchant_id, nonce, expires_at, created_at) VALUES (?, ?, ?, ?)").run(merchantId, nonce, expiresAt, nowIso()); return true; }
  catch (error) { if (String(error).includes("UNIQUE constraint failed")) return false; throw error; }
}

export function setChannelStatus(id: string, status: ChannelStatus): void {
  db.prepare("UPDATE channels SET status = ? WHERE id = ?").run(status, id);
}

export function createAuditLog(input: { action: string; operator?: string; targetType: string; targetId?: string; detail?: unknown }): void {
  db.prepare("INSERT INTO audit_logs (id, action, operator, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomId("audit"), input.action, input.operator ?? "local-admin", input.targetType, input.targetId ?? null, JSON.stringify(input.detail ?? {}), nowIso());
}

export function listAuditLogs(limit = 100, filters: { action?: string; operator?: string; target?: string; dateFrom?: string; dateTo?: string } = {}): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const where: string[] = []; const params: unknown[] = [];
  if (filters.action) { where.push('action LIKE ?'); params.push(`%${filters.action}%`); }
  if (filters.operator) { where.push('operator LIKE ?'); params.push(`%${filters.operator}%`); }
  if (filters.target) { where.push('(target_type LIKE ? OR target_id LIKE ?)'); params.push(`%${filters.target}%`, `%${filters.target}%`); }
  if (filters.dateFrom) { where.push('created_at >= ?'); params.push(`${filters.dateFrom}T00:00:00.000Z`); }
  if (filters.dateTo) { where.push('created_at < ?'); params.push(`${filters.dateTo}T00:00:00.000Z`); }
  const sql = `SELECT id, action, operator, target_type AS targetType, target_id AS targetId, detail, created_at AS createdAt FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params, safeLimit) as Array<Record<string, unknown>>;
}

export interface CreateRouteRuleInput {
  id: string;
  name: string;
  channelIds: string[];
  amountMin?: number;
  amountMax?: number;
  priority?: number;
  weight?: number;
}

function routeRuleSnapshot(rule: Record<string, unknown>): string {
  return JSON.stringify({ id: rule.id, name: rule.name, channelIds: rule.channelIds, amountMin: rule.amountMin ?? null, amountMax: rule.amountMax ?? null, priority: rule.priority, weight: rule.weight, status: rule.status });
}

function recordRouteRuleVersion(rule: Record<string, unknown>, changeType: string, operator = "local-admin"): void {
  const versionRow = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM route_rule_versions WHERE rule_id = ?").get(String(rule.id)) as { version: number };
  db.prepare(`INSERT INTO route_rule_versions (id, rule_id, version, snapshot, change_type, operator, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomId("rversion"), String(rule.id), Number(versionRow.version || 0) + 1, routeRuleSnapshot(rule), changeType, operator, nowIso());
}

export function createRouteRule(input: CreateRouteRuleInput): Record<string, unknown> {
  const timestamp = nowIso();
  db.prepare(`INSERT INTO route_rules (id, name, channel_ids, amount_min, amount_max, priority, weight, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .run(input.id, input.name, JSON.stringify(input.channelIds), input.amountMin ?? null, input.amountMax ?? null, input.priority ?? 100, input.weight ?? 100, timestamp, timestamp);
  recordRouteRuleVersion(getRouteRule(input.id)!, "CREATE");
  createAuditLog({ action: "ROUTE_RULE_CREATE", targetType: "route_rule", targetId: input.id, detail: input });
  return getRouteRule(input.id)!;
}

export function getRouteRule(id: string): Record<string, unknown> | undefined {
  const row = db.prepare(`SELECT id, name, channel_ids AS channelIds, amount_min AS amountMin, amount_max AS amountMax,
    priority, weight, status, created_at AS createdAt, updated_at AS updatedAt FROM route_rules WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const version = db.prepare("SELECT MAX(version) AS version FROM route_rule_versions WHERE rule_id = ?").get(id) as { version?: number } | undefined;
  return { ...row, channelIds: JSON.parse(String(row.channelIds)), version: Number(version?.version || 1) };
}

export function listRouteRules(): Array<Record<string, unknown>> {
  return db.prepare("SELECT id FROM route_rules ORDER BY priority DESC, created_at DESC").all().map((row) => getRouteRule((row as { id: string }).id)!) as Array<Record<string, unknown>>;
}

export function setRouteRuleStatus(id: string, status: "ACTIVE" | "PAUSED" | "DISABLED"): void {
  db.prepare("UPDATE route_rules SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  const updated = getRouteRule(id); if (updated) recordRouteRuleVersion(updated, "STATUS");
  createAuditLog({ action: "ROUTE_RULE_STATUS", targetType: "route_rule", targetId: id, detail: { status, version: updated?.version } });
}

export function updateRouteRule(id: string, input: Partial<Omit<CreateRouteRuleInput, "id">>): Record<string, unknown> {
  const current = getRouteRule(id);
  if (!current) throw new Error("ROUTE_RULE_NOT_FOUND");
  db.prepare(`UPDATE route_rules SET name = ?, channel_ids = ?, amount_min = ?, amount_max = ?, priority = ?, weight = ?, updated_at = ? WHERE id = ?`)
    .run(input.name ?? current.name, JSON.stringify(input.channelIds ?? current.channelIds), input.amountMin ?? current.amountMin ?? null, input.amountMax ?? current.amountMax ?? null, input.priority ?? current.priority, input.weight ?? current.weight, nowIso(), id);
  const updated = getRouteRule(id)!; recordRouteRuleVersion(updated, "UPDATE");
  createAuditLog({ action: "ROUTE_RULE_UPDATE", targetType: "route_rule", targetId: id, detail: { ...input, version: updated.version } });
  return getRouteRule(id)!;
}

export function listRouteRuleVersions(ruleId: string, limit = 50): Array<Record<string, unknown>> {
  const rows = db.prepare(`SELECT id, rule_id AS ruleId, version, snapshot, change_type AS changeType, operator, created_at AS createdAt
    FROM route_rule_versions WHERE rule_id = ? ORDER BY version DESC LIMIT ?`).all(ruleId, Math.max(1, Math.min(limit, 200))) as Array<Record<string, unknown>>;
  return rows.map((row) => { try { return { ...row, snapshot: JSON.parse(String(row.snapshot)) }; } catch { return row; } });
}

export function restoreRouteRuleVersion(ruleId: string, version: number, operator = "local-admin"): Record<string, unknown> {
  const row = db.prepare("SELECT snapshot FROM route_rule_versions WHERE rule_id = ? AND version = ?").get(ruleId, version) as { snapshot?: string } | undefined;
  if (!row) throw new Error("ROUTE_RULE_VERSION_NOT_FOUND");
  const snapshot = JSON.parse(String(row.snapshot)) as Record<string, unknown>;
  db.prepare(`UPDATE route_rules SET name = ?, channel_ids = ?, amount_min = ?, amount_max = ?, priority = ?, weight = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(String(snapshot.name), JSON.stringify(snapshot.channelIds ?? []), snapshot.amountMin ?? null, snapshot.amountMax ?? null, Number(snapshot.priority ?? 100), Number(snapshot.weight ?? 100), String(snapshot.status ?? "PAUSED"), nowIso(), ruleId);
  const updated = getRouteRule(ruleId); if (!updated) throw new Error("ROUTE_RULE_NOT_FOUND");
  recordRouteRuleVersion(updated, "ROLLBACK", operator);
  const current = getRouteRule(ruleId)!;
  createAuditLog({ action: "ROUTE_RULE_ROLLBACK", operator, targetType: "route_rule", targetId: ruleId, detail: { fromVersion: version, version: current.version } });
  return current;
}

export function listSubjects(): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT s.id, s.name, s.subject_type AS subjectType, s.created_at AS createdAt,
      (SELECT COUNT(*) FROM wechat_apps a WHERE a.subject_id = s.id) AS appCount,
      (SELECT COUNT(*) FROM wechat_merchants m WHERE m.subject_id = s.id) AS merchantCount,
      (SELECT COUNT(*) FROM channels c WHERE c.subject_id = s.id) AS channelCount
    FROM merchant_subjects s ORDER BY s.created_at DESC
  `).all() as Array<Record<string, unknown>>;
}

export function listApps(): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT a.id, a.appid, a.app_type AS appType, a.oauth_domain AS oauthDomain, a.jsapi_path AS jsapiPath, a.verify_file AS verifyFile, a.verify_token AS verifyToken, a.status, a.subject_id AS subjectId,
      s.name AS subjectName, COUNT(b.id) AS bindingCount
    FROM wechat_apps a
    JOIN merchant_subjects s ON s.id = a.subject_id
    LEFT JOIN app_mch_bindings b ON b.app_id = a.id
    GROUP BY a.id ORDER BY a.appid
  `).all() as Array<Record<string, unknown>>;
}

export function listMerchants(): Array<Record<string, unknown>> {
  const rows = db.prepare(`
    SELECT m.id, m.mchid, m.credential_ref AS credentialRef, m.status,
      m.daily_amount_limit AS dailyAmountLimit, m.complaint_count AS complaintCount, m.risk_enabled AS riskEnabled,
      m.order_window_seconds AS orderWindowSeconds, m.order_window_limit AS orderWindowLimit,
      m.daily_order_limit AS dailyOrderLimit, m.daily_success_limit AS dailySuccessLimit,
      m.monitor_locked AS monitorLocked, m.monitor_lock_reason AS monitorLockReason,
      m.monitor_locked_at AS monitorLockedAt, m.monitor_lock_source AS monitorLockSource,
      m.subject_id AS subjectId, s.name AS subjectName,
      (SELECT b.app_id FROM app_mch_bindings b WHERE b.merchant_id = m.id ORDER BY b.id LIMIT 1) AS appId,
      (SELECT a.appid FROM app_mch_bindings b JOIN wechat_apps a ON a.id = b.app_id WHERE b.merchant_id = m.id ORDER BY b.id LIMIT 1) AS appid,
      (SELECT COUNT(*) FROM app_mch_bindings b WHERE b.merchant_id = m.id) AS bindingCount,
      (SELECT COUNT(*) FROM channel_merchant_bindings cmb WHERE cmb.merchant_id = m.id AND cmb.binding_status = 'ACTIVE') AS channelCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id) AS orderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS') AS successOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS') AS successAmount,
      (SELECT COALESCE(SUM(r.refund_amount), 0) FROM refund_orders r JOIN orders o ON o.id = r.order_id JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND r.status = 'SUCCESS') AS refundAmount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todayOrderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todaySuccessOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours')) AS todaySuccessAmount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')) AS yesterdayOrderCount,
      (SELECT COUNT(*) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')) AS yesterdaySuccessOrderCount,
      (SELECT COALESCE(SUM(o.amount), 0) FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = m.id AND o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day')) AS yesterdaySuccessAmount
    FROM wechat_merchants m
    JOIN merchant_subjects s ON s.id = m.subject_id
    ORDER BY m.mchid
  `).all() as Array<Record<string, unknown>>;
  const methodsByMerchant = new Map<string, Array<Record<string, unknown>>>();
  for (const method of db.prepare("SELECT p.merchant_id AS merchantId, p.method, p.app_id AS appId, a.appid, p.status FROM merchant_payment_methods p JOIN wechat_apps a ON a.id = p.app_id ORDER BY p.method").all() as Array<Record<string, unknown>>) {
    const key = String(method.merchantId); const methods = methodsByMerchant.get(key) || [];
    methods.push({ method: method.method, appId: method.appId, appid: method.appid, status: method.status }); methodsByMerchant.set(key, methods);
  }
  return rows.map((row) => {
    const orderCount = Number(row.orderCount || 0); const successOrderCount = Number(row.successOrderCount || 0);
    const todayOrderCount = Number(row.todayOrderCount || 0); const todaySuccessOrderCount = Number(row.todaySuccessOrderCount || 0);
    const yesterdayOrderCount = Number(row.yesterdayOrderCount || 0); const yesterdaySuccessOrderCount = Number(row.yesterdaySuccessOrderCount || 0);
    return { ...row, paymentMethods: methodsByMerchant.get(String(row.id)) || [], dailyAmountLimit: Number(row.dailyAmountLimit || 0), complaintCount: Number(row.complaintCount || 0), riskEnabled: Number(row.riskEnabled ?? 1), orderWindowSeconds: Number(row.orderWindowSeconds || 0), orderWindowLimit: Number(row.orderWindowLimit || 0), dailyOrderLimit: Number(row.dailyOrderLimit || 0), dailySuccessLimit: Number(row.dailySuccessLimit || 0), monitorLocked: Number(row.monitorLocked ?? 0), monitorLockReason: row.monitorLockReason ? String(row.monitorLockReason) : '', monitorLockedAt: row.monitorLockedAt ?? null, monitorLockSource: row.monitorLockSource ? String(row.monitorLockSource) : '', orderCount, successOrderCount, successAmount: Number(row.successAmount || 0), refundAmount: Number(row.refundAmount || 0), successRate: orderCount ? Math.round(successOrderCount * 10000 / orderCount) / 100 : 0, todayOrderCount, todaySuccessOrderCount, todaySuccessAmount: Number(row.todaySuccessAmount || 0), todaySuccessRate: todayOrderCount ? Math.round(todaySuccessOrderCount * 10000 / todayOrderCount) / 100 : 0, yesterdayOrderCount, yesterdaySuccessOrderCount, yesterdaySuccessAmount: Number(row.yesterdaySuccessAmount || 0), yesterdaySuccessRate: yesterdayOrderCount ? Math.round(yesterdaySuccessOrderCount * 10000 / yesterdayOrderCount) / 100 : 0 };
  });
}

export function getWechatMerchantStats(merchantId: string): Record<string, unknown> | undefined {
  const merchant = db.prepare("SELECT m.id, m.mchid, s.name AS subjectName FROM wechat_merchants m JOIN merchant_subjects s ON s.id = m.subject_id WHERE m.id = ?").get(merchantId) as Record<string, unknown> | undefined;
  if (!merchant) return undefined;
  const summary = db.prepare(`SELECT COUNT(*) AS orderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS successAmount,
    SUM(CASE WHEN date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todayOrderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todaySuccessCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN o.amount ELSE 0 END), 0) AS todaySuccessAmount,
    SUM(CASE WHEN date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN 1 ELSE 0 END) AS yesterdayOrderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN 1 ELSE 0 END) AS yesterdaySuccessCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN o.amount ELSE 0 END), 0) AS yesterdaySuccessAmount,
    SUM(CASE WHEN date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN 1 ELSE 0 END) AS sevenDayOrderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN 1 ELSE 0 END) AS sevenDaySuccessCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN o.amount ELSE 0 END), 0) AS sevenDaySuccessAmount
    FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = ?`).get(merchantId) as Record<string, unknown>;
  const byChannel = db.prepare(`SELECT o.channel_id AS channelId, c.notify_path AS notifyPath, COUNT(*) AS orderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS successAmount
    FROM orders o JOIN channels c ON c.id = o.channel_id WHERE COALESCE(o.wechat_merchant_id, c.merchant_id) = ? GROUP BY o.channel_id ORDER BY successAmount DESC`).all(merchantId).map((row) => {
      const item = row as Record<string, unknown>; const count = Number(item.orderCount || 0); const success = Number(item.successCount || 0);
      return { ...item, orderCount: count, successCount: success, successAmount: Number(item.successAmount || 0), successRate: count ? Math.round(success * 10000 / count) / 100 : 0 };
    });
  const orderCount = Number(summary.orderCount || 0); const successCount = Number(summary.successCount || 0);
  const todayOrders = Number(summary.todayOrderCount || 0); const todaySuccess = Number(summary.todaySuccessCount || 0);
  const yesterdayOrders = Number(summary.yesterdayOrderCount || 0); const yesterdaySuccess = Number(summary.yesterdaySuccessCount || 0);
  const sevenOrders = Number(summary.sevenDayOrderCount || 0); const sevenSuccess = Number(summary.sevenDaySuccessCount || 0);
  return { merchant, ...summary, orderCount, successCount, successAmount: Number(summary.successAmount || 0), successRate: orderCount ? Math.round(successCount * 10000 / orderCount) / 100 : 0, todayOrderCount: todayOrders, todaySuccessCount: todaySuccess, todaySuccessAmount: Number(summary.todaySuccessAmount || 0), todaySuccessRate: todayOrders ? Math.round(todaySuccess * 10000 / todayOrders) / 100 : 0, yesterdayOrderCount: yesterdayOrders, yesterdaySuccessCount: yesterdaySuccess, yesterdaySuccessAmount: Number(summary.yesterdaySuccessAmount || 0), yesterdaySuccessRate: yesterdayOrders ? Math.round(yesterdaySuccess * 10000 / yesterdayOrders) / 100 : 0, sevenDayOrderCount: sevenOrders, sevenDaySuccessCount: sevenSuccess, sevenDaySuccessAmount: Number(summary.sevenDaySuccessAmount || 0), sevenDaySuccessRate: sevenOrders ? Math.round(sevenSuccess * 10000 / sevenOrders) / 100 : 0, byChannel };
}

export function getChannelStats(channelId: string): Record<string, unknown> | undefined {
  if (!getChannel(channelId)) return undefined;
  const row = db.prepare(`
    SELECT COUNT(*) AS orderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS successAmount,
      COALESCE((SELECT SUM(r.refund_amount) FROM refund_orders r JOIN orders ro ON ro.id = r.order_id WHERE ro.channel_id = ? AND r.status = 'SUCCESS'), 0) AS refundAmount,
      SUM(CASE WHEN date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todayOrderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN 1 ELSE 0 END) AS todaySuccessOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours') THEN o.amount ELSE 0 END), 0) AS todaySuccessAmount,
      SUM(CASE WHEN date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN 1 ELSE 0 END) AS yesterdayOrderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN 1 ELSE 0 END) AS yesterdaySuccessOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') = date('now', '+8 hours', '-1 day') THEN o.amount ELSE 0 END), 0) AS yesterdaySuccessAmount,
      SUM(CASE WHEN date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN 1 ELSE 0 END) AS sevenDayOrderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN 1 ELSE 0 END) AS sevenDaySuccessOrderCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' AND date(o.created_at, '+8 hours') >= date('now', '+8 hours', '-6 days') THEN o.amount ELSE 0 END), 0) AS sevenDaySuccessAmount
    FROM orders o WHERE o.channel_id = ?
  `).get(channelId, channelId) as Record<string, unknown>;
  const orderCount = Number(row.orderCount || 0); const successOrderCount = Number(row.successOrderCount || 0);
  const todayOrderCount = Number(row.todayOrderCount || 0); const todaySuccessOrderCount = Number(row.todaySuccessOrderCount || 0);
  const yesterdayOrderCount = Number(row.yesterdayOrderCount || 0); const yesterdaySuccessOrderCount = Number(row.yesterdaySuccessOrderCount || 0); const sevenDayOrderCount = Number(row.sevenDayOrderCount || 0); const sevenDaySuccessOrderCount = Number(row.sevenDaySuccessOrderCount || 0);
  return { ...row, orderCount, successOrderCount, successAmount: Number(row.successAmount || 0), refundAmount: Number(row.refundAmount || 0), successRate: orderCount ? Math.round(successOrderCount * 10000 / orderCount) / 100 : 0, todayOrderCount, todaySuccessOrderCount, todaySuccessAmount: Number(row.todaySuccessAmount || 0), todaySuccessRate: todayOrderCount ? Math.round(todaySuccessOrderCount * 10000 / todayOrderCount) / 100 : 0, yesterdayOrderCount, yesterdaySuccessOrderCount, yesterdaySuccessAmount: Number(row.yesterdaySuccessAmount || 0), yesterdaySuccessRate: yesterdayOrderCount ? Math.round(yesterdaySuccessOrderCount * 10000 / yesterdayOrderCount) / 100 : 0, sevenDayOrderCount, sevenDaySuccessOrderCount, sevenDaySuccessAmount: Number(row.sevenDaySuccessAmount || 0), sevenDaySuccessRate: sevenDayOrderCount ? Math.round(sevenDaySuccessOrderCount * 10000 / sevenDayOrderCount) / 100 : 0 };
}

export function listOrders(limit = 100, status?: string): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  if (status) {
    return db.prepare(`
      SELECT o.id, o.merchant_id AS merchantId, o.platform_order_no AS platformOrderNo,
        o.channel_out_trade_no AS channelOutTradeNo, o.amount, o.description, o.status,
        o.transaction_id AS transactionId, o.expire_at AS expireAt, o.created_at AS createdAt,
        o.paid_at AS paidAt, o.device_type AS deviceType, o.device_ip AS deviceIp, o.device_country AS deviceCountry, o.device_province AS deviceProvince, o.device_city AS deviceCity, o.device_no AS deviceNo, o.channel_id AS channelId, a.appid AS appId, m.mchid AS mchId,
        s.name AS subjectName
      FROM orders o
      JOIN channels c ON c.id = o.channel_id
      JOIN wechat_apps a ON a.id = c.app_id
      JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id)
      JOIN merchant_subjects s ON s.id = c.subject_id
      WHERE o.status = ? ORDER BY o.created_at DESC LIMIT ?
    `).all(status, safeLimit) as Array<Record<string, unknown>>;
  }
  return db.prepare(`
    SELECT o.id, o.merchant_id AS merchantId, o.platform_order_no AS platformOrderNo,
      o.channel_out_trade_no AS channelOutTradeNo, o.amount, o.description, o.status,
      o.transaction_id AS transactionId, o.expire_at AS expireAt, o.created_at AS createdAt,
      o.paid_at AS paidAt, o.device_type AS deviceType, o.device_ip AS deviceIp, o.device_country AS deviceCountry, o.device_province AS deviceProvince, o.device_city AS deviceCity, o.device_no AS deviceNo, o.channel_id AS channelId, a.appid AS appId, m.mchid AS mchId,
      s.name AS subjectName
    FROM orders o
    JOIN channels c ON c.id = o.channel_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id)
    JOIN merchant_subjects s ON s.id = c.subject_id
    ORDER BY o.created_at DESC LIMIT ?
  `).all(safeLimit) as Array<Record<string, unknown>>;
}

export interface OrderSearchInput {
  page?: number; pageSize?: number; status?: string; query?: string; channelId?: string; merchantId?: string; merchantIds?: string[]; clientMerchantId?: string; clientMerchantIds?: string[]; channelIds?: string[];
  dateFrom?: string; dateTo?: string; amountMin?: number; amountMax?: number; exceptionOnly?: boolean;
}
export function searchOrders(input: OrderSearchInput = {}): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; metrics: Record<string, number> } {
  const page = Math.max(1, Number(input.page || 1)); const pageSize = Math.max(1, Math.min(Number(input.pageSize || 50), 200));
  const where: string[] = []; const params: unknown[] = [];
  if (input.status) { where.push("o.status = ?"); params.push(input.status); }
  if (input.query) { where.push("(o.platform_order_no LIKE ? OR o.channel_out_trade_no LIKE ? OR o.client_request_no LIKE ? OR COALESCE(o.transaction_id, '') LIKE ? OR m.mchid LIKE ? OR m.id LIKE ?)"); const q = `%${input.query}%`; params.push(q, q, q, q, q, q); }
  if (input.channelId) { where.push("o.channel_id = ?"); params.push(input.channelId); }
  if (input.merchantId) { where.push("o.merchant_id = ?"); params.push(input.merchantId); }
  if (input.merchantIds?.length) { where.push(`o.merchant_id IN (${input.merchantIds.map(() => '?').join(',')})`); params.push(...input.merchantIds); }
  if (input.clientMerchantId) { where.push("o.client_merchant_id = ?"); params.push(input.clientMerchantId); }
  if (input.clientMerchantIds?.length) { where.push(`o.client_merchant_id IN (${input.clientMerchantIds.map(() => '?').join(',')})`); params.push(...input.clientMerchantIds); }
  if (input.channelIds?.length) { where.push(`o.channel_id IN (${input.channelIds.map(() => '?').join(',')})`); params.push(...input.channelIds); }
  if (input.dateFrom) { where.push("o.created_at >= ?"); params.push(input.dateFrom); }
  if (input.dateTo) { where.push("o.created_at < ?"); params.push(input.dateTo); }
  if (input.amountMin != null) { where.push("o.amount >= ?"); params.push(input.amountMin); }
  if (input.amountMax != null) { where.push("o.amount <= ?"); params.push(input.amountMax); }
  if (input.exceptionOnly) { where.push("(o.status IN ('UNKNOWN','FAILED') OR (o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING') AND o.expire_at < ?))"); params.push(nowIso()); }
  const from = `FROM orders o JOIN channels c ON c.id = o.channel_id JOIN wechat_apps a ON a.id = c.app_id JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id) JOIN merchant_subjects s ON s.id = c.subject_id LEFT JOIN platform_merchants pm ON pm.id = o.merchant_id LEFT JOIN client_merchants cm ON cm.id = o.client_merchant_id`;
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const total = Number((db.prepare(`SELECT COUNT(*) AS count ${from}${clause}`).get(...params) as { count: number }).count);
  const summary = db.prepare(`SELECT
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS successAmount,
    SUM(CASE WHEN o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING') THEN 1 ELSE 0 END) AS pendingCount,
    SUM(CASE WHEN o.status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownCount
    ${from}${clause}`).get(...params) as Record<string, unknown>;
  const rows = db.prepare(`SELECT o.id, o.merchant_id AS merchantId, COALESCE(pm.name, o.merchant_id) AS merchantName, cm.name AS clientMerchantName,
    o.platform_order_no AS platformOrderNo, o.channel_out_trade_no AS channelOutTradeNo, o.client_request_no AS clientRequestNo,
    o.amount, o.description, o.status, o.transaction_id AS transactionId, o.expire_at AS expireAt, o.created_at AS createdAt,
    o.paid_at AS paidAt, o.channel_id AS channelId, o.route_rule_id AS routeRuleId, o.route_snapshot AS routeSnapshot, o.route_selected_at AS routeSelectedAt,
    o.user_id AS userId, o.payment_openid_hash AS paymentOpenidHash, o.device_type AS deviceType, o.device_ip AS deviceIp, o.device_country AS deviceCountry, o.device_province AS deviceProvince, o.device_city AS deviceCity, o.device_no AS deviceNo,
    o.wechat_merchant_id AS wechatMerchantId, a.appid AS appId, m.mchid AS mchId, s.name AS subjectName,
    CASE WHEN o.status = 'UNKNOWN' THEN 'STATUS_UNKNOWN' WHEN o.status = 'FAILED' THEN 'PAYMENT_FAILED'
      WHEN o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING') AND o.expire_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'PAYMENT_TIMEOUT' ELSE NULL END AS exceptionType
    ${from}${clause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  return { items: rows, total, page, pageSize, metrics: { successCount: Number(summary.successCount || 0), successAmount: Number(summary.successAmount || 0), pendingCount: Number(summary.pendingCount || 0), unknownCount: Number(summary.unknownCount || 0) } };
}

export function getOrderDetail(idOrPlatformNo: string): Record<string, unknown> | undefined {
  const order = db.prepare(`SELECT o.id, o.merchant_id AS merchantId, COALESCE(pm.name, o.merchant_id) AS merchantName,
    o.platform_order_no AS platformOrderNo, o.channel_out_trade_no AS channelOutTradeNo, o.client_request_no AS clientRequestNo,
    o.amount, o.description, o.status, o.code_url AS codeUrl, o.qr_data_url AS qrDataUrl, o.transaction_id AS transactionId,
    o.expire_at AS expireAt, o.created_at AS createdAt, o.paid_at AS paidAt, o.channel_id AS channelId,
    o.user_id AS userId, o.payment_openid_hash AS paymentOpenidHash, o.device_type AS deviceType, o.device_ip AS deviceIp, o.device_country AS deviceCountry, o.device_province AS deviceProvince, o.device_city AS deviceCity, o.device_no AS deviceNo,
    o.client_merchant_id AS clientMerchantId, o.route_rule_id AS routeRuleId, o.route_snapshot AS routeSnapshot, o.route_selected_at AS routeSelectedAt,
    c.notify_path AS notifyPath, a.appid AS appId, m.mchid AS mchId, m.credential_ref AS credentialRef, s.name AS subjectName,
    c.route_weight AS routeWeight FROM orders o JOIN channels c ON c.id = o.channel_id JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id) JOIN merchant_subjects s ON s.id = c.subject_id LEFT JOIN platform_merchants pm ON pm.id = o.merchant_id
    WHERE o.id = ? OR o.platform_order_no = ?`).get(idOrPlatformNo, idOrPlatformNo) as Record<string, unknown> | undefined;
  if (!order) return undefined;
  const attempts = db.prepare("SELECT id, channel_id AS channelId, status, error_code AS errorCode, created_at AS createdAt FROM payment_attempts WHERE order_id = ? ORDER BY created_at DESC").all(order.id) as Array<Record<string, unknown>>;
  const events = db.prepare("SELECT id, event_type AS eventType, from_status AS fromStatus, to_status AS toStatus, detail, created_at AS createdAt FROM order_events WHERE order_id = ? ORDER BY created_at ASC").all(order.id).map((event) => ({ ...event as Record<string, unknown>, detail: JSON.parse(String((event as Record<string, unknown>).detail || "{}")) }));
  const refunds = db.prepare("SELECT refund_no AS refundNo, refund_amount AS refundAmount, reason, status, approval_status AS approvalStatus, created_at AS createdAt, completed_at AS completedAt FROM refund_orders WHERE order_id = ? ORDER BY created_at DESC").all(order.id) as Array<Record<string, unknown>>;
  const callbacks = db.prepare("SELECT id, notification_id AS notificationId, event_type AS eventType, created_at AS createdAt FROM webhook_events WHERE channel_id = ? AND out_trade_no = ? ORDER BY created_at DESC").all(order.channelId, order.channelOutTradeNo) as Array<Record<string, unknown>>;
  const exceptionActions = listOrderExceptionActions(String(order.id));
  if (typeof order.routeSnapshot === "string") { try { order.routeSnapshot = JSON.parse(order.routeSnapshot); } catch { /* preserve malformed snapshot for diagnostics */ } }
  return { ...order, attempts, events, refunds, callbacks, exceptionActions };
}

export type OrderExceptionAction = "QUERY" | "CLOSE" | "MARK_UNKNOWN" | "REOPEN" | "RETRY_CALLBACK" | "MANUAL_SUPPLEMENT";

export function recordOrderExceptionAction(input: { orderId: string; action: OrderExceptionAction; operator?: string; result: string; note?: string }): Record<string, unknown> {
  const order = getOrder(input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const id = randomId("order-action");
  db.prepare(`INSERT INTO order_exception_actions (id, order_id, action, operator, result, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, input.orderId, input.action, input.operator ?? "local-admin", input.result, input.note ?? null, nowIso());
  return db.prepare(`SELECT id, order_id AS orderId, action, operator, result, note, created_at AS createdAt
    FROM order_exception_actions WHERE id = ?`).get(id) as Record<string, unknown>;
}

export function listOrderExceptionActions(orderId: string, limit = 50): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  return db.prepare(`SELECT id, order_id AS orderId, action, operator, result, note, created_at AS createdAt
    FROM order_exception_actions WHERE order_id = ? ORDER BY created_at DESC LIMIT ?`).all(orderId, safeLimit) as Array<Record<string, unknown>>;
}

export function getExceptionMetrics(): Record<string, number> {
  const row = db.prepare(`SELECT
    SUM(CASE WHEN status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownCount,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failedCount,
    SUM(CASE WHEN status IN ('CREATED','ROUTED','QR_CREATED','PAYING') AND expire_at < strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END) AS timeoutCount,
    COUNT(*) AS totalCount FROM orders WHERE status IN ('UNKNOWN','FAILED','CREATED','ROUTED','QR_CREATED','PAYING')`).get() as Record<string, unknown>;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)])) as Record<string, number>;
}

export function getOverview(): Record<string, number> {
  const count = (sql: string): number => Number((db.prepare(sql).get() as { count: number }).count);
  return {
    subjects: count("SELECT COUNT(*) AS count FROM merchant_subjects"),
    apps: count("SELECT COUNT(*) AS count FROM wechat_apps"),
    merchants: count("SELECT COUNT(*) AS count FROM wechat_merchants"),
    channels: count("SELECT COUNT(*) AS count FROM channels"),
    activeChannels: count("SELECT COUNT(*) AS count FROM channels WHERE status = 'ACTIVE'"),
    orders: count("SELECT COUNT(*) AS count FROM orders"),
    pendingOrders: count("SELECT COUNT(*) AS count FROM orders WHERE status IN ('CREATED', 'ROUTED', 'QR_CREATED', 'PAYING', 'UNKNOWN')"),
    successOrders: count("SELECT COUNT(*) AS count FROM orders WHERE status = 'SUCCESS'"),
    refunds: count("SELECT COUNT(*) AS count FROM refund_orders"),
    processingRefunds: count("SELECT COUNT(*) AS count FROM refund_orders WHERE status IN ('PROCESSING', 'PENDING')"),
    routeRules: count("SELECT COUNT(*) AS count FROM route_rules"),
    activeRouteRules: count("SELECT COUNT(*) AS count FROM route_rules WHERE status = 'ACTIVE'"),
    auditLogs: count("SELECT COUNT(*) AS count FROM audit_logs")
  };
}

export function closeOrder(id: string): void {
  const order = getOrder(id);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (["SUCCESS", "CLOSED"].includes(order.status)) throw new Error("ORDER_CANNOT_CLOSE");
  updateOrderPayment(id, { status: "CLOSED" });
}

export function listWebhookEvents(limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`
    SELECT e.id, e.channel_id AS channelId, e.notification_id AS notificationId,
      e.out_trade_no AS outTradeNo, e.event_type AS eventType, e.created_at AS createdAt
    FROM webhook_events e ORDER BY e.created_at DESC LIMIT ?
  `).all(safeLimit) as Array<Record<string, unknown>>;
}

export function getRefundedAmount(orderId: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM refund_orders WHERE order_id = ? AND approval_status != 'REJECTED' AND status NOT IN ('CLOSED', 'ABNORMAL')").get(orderId) as { amount: number };
  return Number(row.amount);
}

export function insertRefund(input: { orderId: string; refundNo: string; amount: number; reason: string; status: string; providerRefundId?: string; approvalStatus?: "PENDING" | "APPROVED" | "REJECTED"; requestedBy?: string }): Record<string, unknown> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("REFUND_AMOUNT_INVALID");
  const tx = db.transaction(() => {
    const order = db.prepare("SELECT amount, status FROM orders WHERE id = ?").get(input.orderId) as { amount: number; status: string } | undefined;
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== "SUCCESS") throw new Error("ORDER_NOT_PAID");
    const existing = db.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM refund_orders WHERE order_id = ? AND approval_status != 'REJECTED' AND status NOT IN ('CLOSED','ABNORMAL')").get(input.orderId) as { amount: number };
    if (Number(existing.amount) + input.amount > Number(order.amount)) throw new Error("REFUND_AMOUNT_EXCEEDED");
    const timestamp = nowIso();
    db.prepare(`INSERT INTO refund_orders
      (id, order_id, refund_no, refund_amount, reason, status, approval_status, requested_by, provider_refund_id, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomId("refund"), input.orderId, input.refundNo, input.amount, input.reason, input.status, input.approvalStatus ?? "APPROVED", input.requestedBy ?? null,
        input.providerRefundId ?? null, timestamp, input.status === "SUCCESS" ? timestamp : null);
  });
  tx();
  const refund = getRefund(input.refundNo)!;
  if (refund.merchantId) enqueueMerchantWebhook(String(refund.merchantId), "REFUND_CREATED", `${input.refundNo}:CREATED`, refund);
  return refund;
}

export function getRefund(refundNo: string): Record<string, unknown> | undefined {
  return db.prepare(`
    SELECT r.id, r.order_id AS orderId, o.merchant_id AS merchantId, o.client_merchant_id AS clientMerchantId, o.platform_order_no AS platformOrderNo,
      r.refund_no AS refundNo, r.refund_amount AS refundAmount, r.reason, r.status,
      r.approval_status AS approvalStatus, r.requested_by AS requestedBy, r.reviewed_by AS reviewedBy,
      r.reviewed_at AS reviewedAt, r.reject_reason AS rejectReason, r.provider_refund_id AS providerRefundId,
      r.created_at AS createdAt, r.completed_at AS completedAt
    FROM refund_orders r JOIN orders o ON o.id = r.order_id WHERE r.refund_no = ?
  `).get(refundNo) as Record<string, unknown> | undefined;
}

export function updateRefundStatus(refundNo: string, status: string, providerRefundId?: string): Record<string, unknown> | undefined {
  const previous = getRefund(refundNo);
  const allowed = new Set(["PENDING", "PROCESSING", "SUCCESS", "CLOSED", "ABNORMAL"]);
  const normalized = allowed.has(status) ? status : "PROCESSING";
  const transitions: Record<string, string[]> = {
    PENDING: ["PENDING", "PROCESSING", "SUCCESS", "CLOSED", "ABNORMAL"],
    PROCESSING: ["PENDING", "PROCESSING", "SUCCESS", "CLOSED", "ABNORMAL"],
    SUCCESS: ["SUCCESS"], CLOSED: ["CLOSED"], ABNORMAL: ["ABNORMAL"]
  };
  if (previous && !(transitions[String(previous.status)] || []).includes(normalized)) throw new Error("REFUND_STATUS_TRANSITION_INVALID");
  db.prepare("UPDATE refund_orders SET status = ?, provider_refund_id = COALESCE(?, provider_refund_id), completed_at = CASE WHEN ? IN ('SUCCESS', 'CLOSED', 'ABNORMAL') THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE refund_no = ?")
    .run(normalized, providerRefundId ?? null, normalized, nowIso(), refundNo);
  const refund = getRefund(refundNo);
  if (refund && refund.merchantId && normalized === "SUCCESS" && previous?.status !== "SUCCESS") {
    recordMerchantRefundSuccess(refundNo, String(refund.merchantId), Number(refund.refundAmount));
    if (refund.clientMerchantId) recordClientMerchantRefundSuccess(String(refund.clientMerchantId), refundNo, Number(refund.refundAmount));
  }
  if (refund && refund.merchantId) enqueueMerchantWebhook(String(refund.merchantId), "REFUND_STATUS", `${refundNo}:${normalized}`, refund);
  return refund;
}

export function updateRefundApproval(refundNo: string, approvalStatus: "APPROVED" | "REJECTED", reviewer: string, reason?: string): Record<string, unknown> | undefined {
  const now = nowIso();
  db.prepare(`UPDATE refund_orders SET approval_status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ?,
    status = CASE WHEN ? = 'REJECTED' THEN 'ABNORMAL' ELSE status END,
    completed_at = CASE WHEN ? = 'REJECTED' THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE refund_no = ?`)
    .run(approvalStatus, reviewer, now, reason ?? null, approvalStatus, approvalStatus, now, refundNo);
  const refund = getRefund(refundNo);
  if (refund && refund.merchantId) enqueueMerchantWebhook(String(refund.merchantId), "REFUND_APPROVAL", `${refundNo}:${approvalStatus}`, refund);
  return refund;
}
export function claimRefundApproval(refundNo: string, reviewer: string): boolean {
  const result = db.prepare("UPDATE refund_orders SET approval_status = 'REVIEWING', reviewed_by = ?, reviewed_at = ? WHERE refund_no = ? AND approval_status = 'PENDING'").run(reviewer, nowIso(), refundNo);
  return result.changes === 1;
}
export function restoreRefundApproval(refundNo: string): void {
  db.prepare("UPDATE refund_orders SET approval_status = 'PENDING', reviewed_by = NULL, reviewed_at = NULL WHERE refund_no = ? AND approval_status = 'REVIEWING'").run(refundNo);
}

export function listRecoverableRefunds(limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`SELECT r.id, r.refund_no AS refundNo, r.refund_amount AS refundAmount, r.status,
    r.provider_refund_id AS providerRefundId, r.order_id AS orderId, o.platform_order_no AS platformOrderNo,
    o.channel_id AS channelId, o.channel_out_trade_no AS channelOutTradeNo, o.amount AS orderAmount,
    m.mchid, m.credential_ref AS credentialRef
    FROM refund_orders r JOIN orders o ON o.id = r.order_id JOIN channels c ON c.id = o.channel_id
    JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id)
    WHERE r.approval_status = 'APPROVED' AND r.status IN ('PENDING', 'PROCESSING') ORDER BY r.created_at ASC LIMIT ?`).all(safeLimit) as Array<Record<string, unknown>>;
}

const defaultBotNotificationSettings = {
  channelCircuit: true,
  channelFailure: true,
  callbackFailure: true,
  dailyReport: true,
  lowBalance: true,
  complaint: true
};
const defaultBotThresholds = {
  channelFailureCount: 3,
  callbackFailureCount: 3,
  lowBalanceAmount: 0,
  complaintCount: 0
};
function parseBotJson(value: string | null | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback; } catch { return fallback; }
}
export function getBotSettings(): Record<string, unknown> {
  const row = db.prepare("SELECT * FROM bot_settings WHERE id = 'default'").get() as Record<string, any> | undefined;
  const token = row?.bot_token ? decryptSecret(String(row.bot_token)) : "";
  return {
    enabled: Boolean(row?.enabled), configured: Boolean(token),
    botTokenMasked: token ? `••••${token.slice(-4)}` : "",
    webhookUrl: String(row?.webhook_url ?? ""), adminGroupId: String(row?.admin_group_id ?? ""),
    reportEnabled: Boolean(row?.report_enabled), reportTime: String(row?.report_time ?? "23:30"),
    notificationSettings: parseBotJson(row?.notification_settings, defaultBotNotificationSettings),
    thresholds: parseBotJson(row?.thresholds, defaultBotThresholds), updatedAt: row?.updated_at ?? null
  };
}
export function getBotToken(): string { const row = db.prepare("SELECT bot_token FROM bot_settings WHERE id = 'default'").get() as { bot_token?: string } | undefined; return row?.bot_token ? decryptSecret(String(row.bot_token)) : ""; }
export function saveBotSettings(input: { enabled?: boolean; botToken?: string; webhookUrl?: string; adminGroupId?: string; reportEnabled?: boolean; reportTime?: string; notificationSettings?: Record<string, boolean>; thresholds?: Record<string, number> }): Record<string, unknown> {
  const current = db.prepare("SELECT * FROM bot_settings WHERE id = 'default'").get() as Record<string, any> | undefined;
  const token = input.botToken?.trim() ? encryptSecret(input.botToken.trim()) : String(current?.bot_token ?? "");
  const settings = { ...parseBotJson(current?.notification_settings, defaultBotNotificationSettings), ...(input.notificationSettings ?? {}) };
  const thresholds = { ...parseBotJson(current?.thresholds, defaultBotThresholds), ...(input.thresholds ?? {}) };
  const timestamp = nowIso();
  db.prepare(`INSERT INTO bot_settings (id, enabled, bot_token, webhook_url, admin_group_id, report_enabled, report_time, notification_settings, thresholds, updated_at)
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, bot_token=excluded.bot_token, webhook_url=excluded.webhook_url, admin_group_id=excluded.admin_group_id, report_enabled=excluded.report_enabled, report_time=excluded.report_time, notification_settings=excluded.notification_settings, thresholds=excluded.thresholds, updated_at=excluded.updated_at`)
    .run(input.enabled === undefined ? Number(Boolean(current?.enabled)) : Number(input.enabled), token, input.webhookUrl ?? String(current?.webhook_url ?? ""), input.adminGroupId ?? String(current?.admin_group_id ?? ""), input.reportEnabled === undefined ? Number(Boolean(current?.report_enabled)) : Number(input.reportEnabled), input.reportTime ?? String(current?.report_time ?? "23:30"), JSON.stringify(settings), JSON.stringify(thresholds), timestamp);
  return getBotSettings();
}
export function listBotRecipientGroups(): Array<Record<string, unknown>> {
  return db.prepare("SELECT id, name, chat_id AS chatId, scope_type AS scopeType, scope_id AS scopeId, enabled, created_at AS createdAt, updated_at AS updatedAt FROM bot_recipient_groups ORDER BY created_at DESC").all().map((row: any) => ({ ...row, enabled: Boolean(row.enabled) })) as Array<Record<string, unknown>>;
}
export function upsertBotRecipientGroup(input: { id?: string; name: string; chatId: string; scopeType?: string; scopeId?: string; enabled?: boolean }): Record<string, unknown> {
  const id = input.id ?? randomId("botgroup"); const timestamp = nowIso();
  db.prepare(`INSERT INTO bot_recipient_groups (id, name, chat_id, scope_type, scope_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, chat_id=excluded.chat_id, scope_type=excluded.scope_type, scope_id=excluded.scope_id, enabled=excluded.enabled, updated_at=excluded.updated_at`).run(id, input.name.trim(), input.chatId.trim(), input.scopeType ?? "PLATFORM", input.scopeId?.trim() || null, Number(input.enabled !== false), timestamp, timestamp);
  return listBotRecipientGroups().find((item) => item.id === id)!;
}
export function deleteBotRecipientGroup(id: string): void { db.prepare("DELETE FROM bot_recipient_groups WHERE id = ?").run(id); }
export function recordBotDelivery(input: { chatId: string; eventType: string; message: string; status: string; error?: string }): void { db.prepare("INSERT INTO bot_delivery_logs (id, chat_id, event_type, message, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomId("botlog"), input.chatId, input.eventType, input.message.slice(0, 4000), input.status, input.error ?? null, nowIso()); }
export function listBotDeliveryLogs(limit = 50): Array<Record<string, unknown>> { const safe = Math.max(1, Math.min(limit, 200)); return db.prepare("SELECT id, chat_id AS chatId, event_type AS eventType, message, status, error, created_at AS createdAt FROM bot_delivery_logs ORDER BY created_at DESC LIMIT ?").all(safe) as Array<Record<string, unknown>>; }
function botStatDate(date = new Date()): string { return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); }
function purgeBotLedger(): void { db.prepare("DELETE FROM bot_ledger_entries WHERE stat_date < ?").run(botStatDate(new Date(Date.now() - 86_400_000))); }
export function listBotOperators(chatId: string): Array<Record<string, unknown>> { return db.prepare("SELECT chat_id AS chatId, user_id AS userId, username, role, created_at AS createdAt FROM bot_group_operators WHERE chat_id = ? ORDER BY created_at").all(chatId) as Array<Record<string, unknown>>; }
export function upsertBotOperator(input: { chatId: string; userId: string; username?: string }): void { db.prepare(`INSERT INTO bot_group_operators (chat_id, user_id, username, role, created_at) VALUES (?, ?, ?, 'OPERATOR', ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET username=excluded.username`).run(input.chatId, input.userId, input.username ?? null, nowIso()); }
export function deleteBotOperator(chatId: string, userIdOrUsername: string): boolean { const result = db.prepare("DELETE FROM bot_group_operators WHERE chat_id = ? AND (user_id = ? OR LOWER(COALESCE(username, '')) = LOWER(?))").run(chatId, userIdOrUsername, userIdOrUsername.replace(/^@/, "")); return result.changes > 0; }
export function isBotOperator(chatId: string, userId: string, username?: string): boolean { return Boolean(db.prepare("SELECT 1 FROM bot_group_operators WHERE chat_id = ? AND (user_id = ? OR LOWER(COALESCE(username, '')) = LOWER(?))").get(chatId, userId, String(username ?? "").replace(/^@/, ""))); }
export function bindBotMerchant(chatId: string, merchantId: string): void { db.prepare("INSERT OR IGNORE INTO bot_group_merchants (chat_id, merchant_id, created_at) VALUES (?, ?, ?)").run(chatId, merchantId, nowIso()); }
export function listBotBoundMerchants(chatId: string): Array<Record<string, unknown>> { return db.prepare("SELECT p.id, p.code, p.name, p.status FROM bot_group_merchants b JOIN platform_merchants p ON p.id = b.merchant_id WHERE b.chat_id = ? ORDER BY p.name").all(chatId) as Array<Record<string, unknown>>; }
export function addBotLedgerEntry(input: { chatId: string; merchantId?: string; entryType: string; amount: number; note?: string; operatorUserId?: string; operatorUsername?: string }): Record<string, unknown> { purgeBotLedger(); const now = nowIso(); const id = randomId("botledger"); db.prepare("INSERT INTO bot_ledger_entries (id, chat_id, merchant_id, entry_type, amount, note, operator_user_id, operator_username, stat_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.chatId, input.merchantId ?? null, input.entryType, Math.trunc(input.amount), input.note ?? null, input.operatorUserId ?? null, input.operatorUsername ?? null, botStatDate(), now); return db.prepare("SELECT id, chat_id AS chatId, merchant_id AS merchantId, entry_type AS entryType, amount, note, operator_username AS operatorUsername, stat_date AS statDate, created_at AS createdAt FROM bot_ledger_entries WHERE id = ?").get(id) as Record<string, unknown>; }
export function listBotLedgerEntries(chatId: string, statDate = botStatDate()): Array<Record<string, unknown>> { purgeBotLedger(); return db.prepare("SELECT id, chat_id AS chatId, merchant_id AS merchantId, entry_type AS entryType, amount, note, operator_username AS operatorUsername, stat_date AS statDate, created_at AS createdAt FROM bot_ledger_entries WHERE chat_id = ? AND stat_date = ? ORDER BY created_at DESC").all(chatId, statDate) as Array<Record<string, unknown>>; }
export function removeLastBotLedgerEntry(chatId: string, statDate = botStatDate()): boolean { const row = db.prepare("SELECT id FROM bot_ledger_entries WHERE chat_id = ? AND stat_date = ? ORDER BY created_at DESC LIMIT 1").get(chatId, statDate) as { id?: string } | undefined; if (!row?.id) return false; return db.prepare("DELETE FROM bot_ledger_entries WHERE id = ?").run(row.id).changes > 0; }
export function clearBotLedger(chatId: string, statDate = botStatDate()): number { return db.prepare("DELETE FROM bot_ledger_entries WHERE chat_id = ? AND stat_date = ?").run(chatId, statDate).changes; }

export function listRefunds(limit = 100, approvalStatus?: string): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const filter = approvalStatus ? " WHERE r.approval_status = ?" : "";
  const values = approvalStatus ? [approvalStatus, safeLimit] : [safeLimit];
  return db.prepare(`
    SELECT r.id, r.order_id AS orderId, o.platform_order_no AS platformOrderNo,
      o.client_merchant_id AS clientMerchantId, o.merchant_id AS merchantId, o.channel_id AS channelId,
      r.refund_no AS refundNo, r.refund_amount AS refundAmount, r.reason, r.status,
      r.approval_status AS approvalStatus, r.requested_by AS requestedBy, r.reviewed_by AS reviewedBy,
      r.reviewed_at AS reviewedAt, r.reject_reason AS rejectReason, r.provider_refund_id AS providerRefundId,
      r.created_at AS createdAt, r.completed_at AS completedAt
    FROM refund_orders r JOIN orders o ON o.id = r.order_id${filter} ORDER BY r.created_at DESC LIMIT ?
  `).all(...values) as Array<Record<string, unknown>>;
}

export function listMerchantRefunds(merchantId: string, limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`SELECT r.id, r.order_id AS orderId, o.platform_order_no AS platformOrderNo,
    r.refund_no AS refundNo, r.refund_amount AS refundAmount, r.reason, r.status,
    r.approval_status AS approvalStatus, r.requested_by AS requestedBy, r.reviewed_by AS reviewedBy,
    r.reviewed_at AS reviewedAt, r.reject_reason AS rejectReason, r.provider_refund_id AS providerRefundId,
    r.created_at AS createdAt, r.completed_at AS completedAt
    FROM refund_orders r JOIN orders o ON o.id = r.order_id
    WHERE o.merchant_id = ? ORDER BY r.created_at DESC LIMIT ?`).all(merchantId, safeLimit) as Array<Record<string, unknown>>;
}

export function getMonitoring(): Array<Record<string, unknown>> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT c.id AS channelId, s.name AS subjectName, a.appid AS appId, m.mchid AS mchId,
      c.status, c.route_weight AS routeWeight,
      COALESCE(h.circuit_state, 'CLOSED') AS circuitState, COALESCE(h.consecutive_failures, 0) AS consecutiveFailures,
      COUNT(o.id) AS orderCount,
      SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
      SUM(CASE WHEN o.status IN ('FAILED', 'UNKNOWN') THEN 1 ELSE 0 END) AS exceptionCount,
      COALESCE(SUM(o.amount), 0) AS orderAmount
    FROM channels c
    JOIN merchant_subjects s ON s.id = c.subject_id
    JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = c.merchant_id
    LEFT JOIN channel_health h ON h.channel_id = c.id
    LEFT JOIN orders o ON o.channel_id = c.id AND o.created_at >= ?
    GROUP BY c.id ORDER BY exceptionCount DESC, successCount DESC
  `).all(since).map((row) => {
    const item = row as Record<string, any>;
    const orderCount = Number(item.orderCount);
    return { ...item, orderCount, successCount: Number(item.successCount), exceptionCount: Number(item.exceptionCount), orderAmount: Number(item.orderAmount), successRate: orderCount ? Math.round(Number(item.successCount) * 10000 / orderCount) / 100 : 0 };
  }) as Array<Record<string, unknown>>;
}

export function ensureChannelHealth(channelId: string): void {
  db.prepare("INSERT OR IGNORE INTO channel_health (channel_id, updated_at) VALUES (?, ?)").run(channelId, nowIso());
}

export function listChannelHealth(): Array<Record<string, unknown>> {
  return db.prepare(`SELECT c.id AS channelId, s.name AS subjectName, a.appid AS appId, m.mchid AS mchId, c.status,
    COALESCE(h.circuit_state, 'CLOSED') AS circuitState, COALESCE(h.consecutive_failures, 0) AS consecutiveFailures,
    COALESCE(h.consecutive_successes, 0) AS consecutiveSuccesses, h.last_check_at AS lastCheckAt, h.last_error AS lastError,
    h.opened_at AS openedAt, h.updated_at AS updatedAt
    FROM channels c JOIN merchant_subjects s ON s.id = c.subject_id JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = c.merchant_id LEFT JOIN channel_health h ON h.channel_id = c.id ORDER BY c.id`).all() as Array<Record<string, unknown>>;
}

export function recordChannelHealth(channelId: string, input: { success: boolean; error?: string; failureThreshold?: number }): Record<string, unknown> {
  ensureChannelHealth(channelId);
  const current = db.prepare("SELECT circuit_state AS circuitState, consecutive_failures AS consecutiveFailures, consecutive_successes AS consecutiveSuccesses FROM channel_health WHERE channel_id = ?").get(channelId) as { circuitState: string; consecutiveFailures: number; consecutiveSuccesses: number };
  const threshold = input.failureThreshold ?? 3;
  const failures = input.success ? 0 : current.consecutiveFailures + 1;
  const successes = input.success ? current.consecutiveSuccesses + 1 : 0;
  const state = input.success ? (current.circuitState === "OPEN" ? "HALF_OPEN" : "CLOSED") : failures >= threshold ? "OPEN" : current.circuitState;
  db.prepare(`UPDATE channel_health SET circuit_state = ?, consecutive_failures = ?, consecutive_successes = ?,
    last_check_at = ?, last_error = ?, opened_at = CASE WHEN ? = 'OPEN' AND circuit_state != 'OPEN' THEN ? ELSE opened_at END, updated_at = ? WHERE channel_id = ?`)
    .run(state, failures, successes, nowIso(), input.error ?? null, state, nowIso(), nowIso(), channelId);
  return listChannelHealth().find((item) => item.channelId === channelId) ?? {};
}

export function resetChannelCircuit(channelId: string): void {
  ensureChannelHealth(channelId);
  db.prepare("UPDATE channel_health SET circuit_state = 'CLOSED', consecutive_failures = 0, consecutive_successes = 0, last_error = NULL, opened_at = NULL, updated_at = ? WHERE channel_id = ?").run(nowIso(), channelId);
}

export function listRecoveryOrders(limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`SELECT o.id, o.platform_order_no AS platformOrderNo, o.channel_id AS channelId, o.channel_out_trade_no AS channelOutTradeNo,
    o.amount, o.status, o.created_at AS createdAt, o.expire_at AS expireAt, m.mchid, m.credential_ref AS credentialRef,
    COALESCE((SELECT COUNT(*) FROM payment_attempts p WHERE p.order_id = o.id AND p.status = 'RECOVERY_QUERY'), 0) AS recoveryAttempts
    FROM orders o JOIN channels c ON c.id = o.channel_id JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id)
    WHERE o.collection_mode = 'NATIVE' AND o.status IN ('CREATED', 'ROUTED', 'QR_CREATED', 'PAYING', 'UNKNOWN') ORDER BY o.created_at ASC LIMIT ?`).all(safeLimit) as Array<Record<string, unknown>>;
}

export function getSettlementReport(input: { dateFrom: string; dateTo: string; channelId?: string; platformMerchantId?: string }): Array<Record<string, unknown>> {
  const clauses = ["o.created_at >= ?", "o.created_at < ?", "o.status = 'SUCCESS'"];
  const params: unknown[] = [input.dateFrom, input.dateTo];
  if (input.channelId) { clauses.push("o.channel_id = ?"); params.push(input.channelId); }
  if (input.platformMerchantId) { clauses.push("o.merchant_id = ?"); params.push(input.platformMerchantId); }
  return db.prepare(`SELECT o.channel_id AS channelId, s.name AS subjectName, m.mchid AS mchId,
    o.merchant_id AS platformMerchantId, COALESCE(pm.name, o.merchant_id) AS platformMerchantName,
    COALESCE(pm.settlement_rate, 0) AS settlementRate,
    COUNT(o.id) AS orderCount, COALESCE(SUM(o.amount), 0) AS grossAmount,
    COALESCE(SUM((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.status = 'SUCCESS')), 0) AS refundAmount
    FROM orders o JOIN channels c ON c.id = o.channel_id JOIN merchant_subjects s ON s.id = c.subject_id
    JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id) LEFT JOIN platform_merchants pm ON pm.id = o.merchant_id
    WHERE ${clauses.join(" AND ")} GROUP BY o.channel_id, o.merchant_id ORDER BY grossAmount DESC`).all(...params).map((row) => {
      const item = row as Record<string, unknown>; const grossAmount = Number(item.grossAmount); const refundAmount = Number(item.refundAmount);
      const settlementRate = Number(item.settlementRate || 0); const netBeforeFee = grossAmount - refundAmount;
      const feeAmount = Math.round(netBeforeFee * settlementRate / 100);
      return { ...item, orderCount: Number(item.orderCount), grossAmount, refundAmount, settlementRate, feeAmount, netAmount: netBeforeFee - feeAmount };
    }) as Array<Record<string, unknown>>;
}

export function listMerchantOrders(merchantId: string, limit = 100, status?: string): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const values: unknown[] = [merchantId];
  const statusClause = status ? " AND o.status = ?" : "";
  if (status) values.push(status);
  values.push(safeLimit);
  return db.prepare(`SELECT o.id, o.merchant_id AS merchantId, o.platform_order_no AS platformOrderNo,
    o.channel_out_trade_no AS channelOutTradeNo, o.amount, o.description, o.status,
    o.transaction_id AS transactionId, o.expire_at AS expireAt, o.created_at AS createdAt,
    o.paid_at AS paidAt, o.channel_id AS channelId, a.appid AS appId, m.mchid AS mchId
    FROM orders o JOIN channels c ON c.id = o.channel_id JOIN wechat_apps a ON a.id = c.app_id
    JOIN wechat_merchants m ON m.id = COALESCE(o.wechat_merchant_id, c.merchant_id) WHERE o.merchant_id = ?${statusClause}
    ORDER BY o.created_at DESC LIMIT ?`).all(...values) as Array<Record<string, unknown>>;
}
export function getMerchantOverview(merchantId: string): Record<string, number> {
  const count = (sql: string): number => Number((db.prepare(sql).get(merchantId) as { count: number }).count);
  const amount = Number((db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'").get(merchantId) as { amount: number }).amount);
  const refund = Number((db.prepare(`SELECT COALESCE(SUM(r.refund_amount),0) AS amount FROM refund_orders r JOIN orders o ON o.id = r.order_id WHERE o.merchant_id = ? AND r.status = 'SUCCESS'`).get(merchantId) as { amount: number }).amount);
  return { orders: count("SELECT COUNT(*) AS count FROM orders WHERE merchant_id = ?"), pendingOrders: count("SELECT COUNT(*) AS count FROM orders WHERE merchant_id = ? AND status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN')"), successOrders: count("SELECT COUNT(*) AS count FROM orders WHERE merchant_id = ? AND status = 'SUCCESS'"), successAmount: amount, refundAmount: refund };
}

export function getMerchantOperationalReport(input: { merchantId: string; dateFrom: string; dateTo: string }): Record<string, unknown> {
  const params = [input.merchantId, input.dateFrom, input.dateTo];
  const daily = db.prepare(`SELECT substr(o.created_at, 1, 10) AS date, COUNT(*) AS orderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    SUM(CASE WHEN o.status IN ('FAILED','CLOSED') THEN 1 ELSE 0 END) AS failedCount,
    SUM(CASE WHEN o.status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknownCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS grossAmount,
    COALESCE(SUM((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.approval_status = 'APPROVED' AND r.status = 'SUCCESS')), 0) AS refundAmount
    FROM orders o WHERE o.merchant_id = ? AND o.created_at >= ? AND o.created_at < ?
    GROUP BY substr(o.created_at, 1, 10) ORDER BY date DESC`).all(...params).map((row) => {
      const item = row as Record<string, unknown>; const orderCount = Number(item.orderCount); const successCount = Number(item.successCount);
      return { ...item, orderCount, successCount, failedCount: Number(item.failedCount), unknownCount: Number(item.unknownCount), grossAmount: Number(item.grossAmount), refundAmount: Number(item.refundAmount), successRate: orderCount ? Math.round(successCount * 10000 / orderCount) / 100 : 0 };
    });
  const byChannel = db.prepare(`SELECT o.channel_id AS channelId, COALESCE(s.name, o.channel_id) AS subjectName, COUNT(*) AS orderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS grossAmount,
    COALESCE(SUM((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.approval_status = 'APPROVED' AND r.status = 'SUCCESS')), 0) AS refundAmount
    FROM orders o LEFT JOIN channels c ON c.id = o.channel_id LEFT JOIN merchant_subjects s ON s.id = c.subject_id
    WHERE o.merchant_id = ? AND o.created_at >= ? AND o.created_at < ? GROUP BY o.channel_id ORDER BY grossAmount DESC`).all(...params).map((row) => {
      const item = row as Record<string, unknown>; return { ...item, orderCount: Number(item.orderCount), successCount: Number(item.successCount), grossAmount: Number(item.grossAmount), refundAmount: Number(item.refundAmount) };
    });
  const totals = daily.reduce((acc, item) => ({ orderCount: acc.orderCount + Number(item.orderCount), successCount: acc.successCount + Number(item.successCount), failedCount: acc.failedCount + Number(item.failedCount), unknownCount: acc.unknownCount + Number(item.unknownCount), grossAmount: acc.grossAmount + Number(item.grossAmount), refundAmount: acc.refundAmount + Number(item.refundAmount) }), { orderCount: 0, successCount: 0, failedCount: 0, unknownCount: 0, grossAmount: 0, refundAmount: 0 });
  return { dateFrom: input.dateFrom, dateTo: input.dateTo, totals: { ...totals, successRate: totals.orderCount ? Math.round(totals.successCount * 10000 / totals.orderCount) / 100 : 0, netAmount: totals.grossAmount - totals.refundAmount }, daily, byChannel };
}

export function getQrSettlementReport(input: { dateFrom: string; dateTo: string; channelId?: string }): Array<Record<string, unknown>> {
  const clauses = ["o.created_at >= ?", "o.created_at < ?"]; const params: unknown[] = [input.dateFrom, input.dateTo];
  if (input.channelId) { clauses.push("o.channel_id = ?"); params.push(input.channelId); }
  return db.prepare(`SELECT o.channel_id AS channelId, q.id AS qrCodeId, q.name AS qrCodeName,
      COUNT(o.id) AS orderCount, SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
      SUM(CASE WHEN o.status IN ('FAILED','CLOSED') THEN 1 ELSE 0 END) AS failedCount,
      SUM(CASE WHEN o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN') THEN 1 ELSE 0 END) AS pendingCount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS grossAmount,
      COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN (SELECT COALESCE(SUM(r.refund_amount), 0) FROM refund_orders r WHERE r.order_id = o.id AND r.status = 'SUCCESS') ELSE 0 END), 0) AS refundAmount
    FROM qr_code_allocations a JOIN orders o ON o.id = a.order_id JOIN qr_collection_codes q ON q.id = a.qr_code_id
    WHERE ${clauses.join(" AND ")} GROUP BY o.channel_id, q.id ORDER BY grossAmount DESC`).all(...params).map((row: any) => {
      const orderCount = Number(row.orderCount || 0); const successCount = Number(row.successCount || 0); const grossAmount = Number(row.grossAmount || 0); const refundAmount = Number(row.refundAmount || 0);
      return { ...row, orderCount, successCount, failedCount: Number(row.failedCount || 0), pendingCount: Number(row.pendingCount || 0), grossAmount, refundAmount, netAmount: grossAmount - refundAmount, successRate: orderCount ? Math.round(successCount * 10000 / orderCount) / 100 : 0 };
    }) as Array<Record<string, unknown>>;
}

export function getAdminOperationalReport(input: { dateFrom: string; dateTo: string }): Record<string, unknown> {
  const params = [input.dateFrom, input.dateTo];
  const daily = db.prepare(`SELECT substr(datetime(o.created_at, '+8 hours'), 1, 10) AS date, COUNT(*) AS orderCount,
    SUM(CASE WHEN o.status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount,
    SUM(CASE WHEN o.status IN ('FAILED','CLOSED') THEN 1 ELSE 0 END) AS failedCount,
    SUM(CASE WHEN o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN') THEN 1 ELSE 0 END) AS pendingCount,
    COALESCE(SUM(CASE WHEN o.status = 'SUCCESS' THEN o.amount ELSE 0 END), 0) AS grossAmount,
    COALESCE(SUM((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.approval_status = 'APPROVED' AND r.status = 'SUCCESS')), 0) AS refundAmount
    FROM orders o WHERE o.created_at >= ? AND o.created_at < ? GROUP BY substr(datetime(o.created_at, '+8 hours'), 1, 10) ORDER BY date`).all(...params).map((row) => {
      const item = row as Record<string, unknown>; const orderCount = Number(item.orderCount); const successCount = Number(item.successCount);
      return { ...item, orderCount, successCount, failedCount: Number(item.failedCount), pendingCount: Number(item.pendingCount), grossAmount: Number(item.grossAmount), refundAmount: Number(item.refundAmount), successRate: orderCount ? Math.round(successCount * 10000 / orderCount) / 100 : 0 };
    });
  const totals = daily.reduce((acc, item) => ({ orderCount: acc.orderCount + Number(item.orderCount), successCount: acc.successCount + Number(item.successCount), failedCount: acc.failedCount + Number(item.failedCount), pendingCount: acc.pendingCount + Number(item.pendingCount), grossAmount: acc.grossAmount + Number(item.grossAmount), refundAmount: acc.refundAmount + Number(item.refundAmount) }), { orderCount: 0, successCount: 0, failedCount: 0, pendingCount: 0, grossAmount: 0, refundAmount: 0 });
  return { dateFrom: input.dateFrom, dateTo: input.dateTo, totals: { ...totals, successRate: totals.orderCount ? Math.round(totals.successCount * 10000 / totals.orderCount) / 100 : 0, netAmount: totals.grossAmount - totals.refundAmount }, daily };
}

export function upsertMerchantWebhook(input: { merchantId: string; url: string; secret: string; enabled?: boolean }): Record<string, unknown> {
  const timestamp = nowIso();
  db.prepare(`INSERT INTO merchant_webhooks (merchant_id, url, secret, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(merchant_id) DO UPDATE SET url = excluded.url, secret = excluded.secret, enabled = excluded.enabled, updated_at = excluded.updated_at`)
    .run(input.merchantId, input.url, encryptSecret(input.secret), input.enabled === false ? 0 : 1, timestamp, timestamp);
  return getMerchantWebhook(input.merchantId)!;
}
export function getMerchantWebhook(merchantId: string): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT merchant_id AS merchantId, url, secret, enabled, created_at AS createdAt, updated_at AS updatedAt FROM merchant_webhooks WHERE merchant_id = ?").get(merchantId) as Record<string, unknown> | undefined;
  if (row?.secret) row.secret = decryptSecret(String(row.secret));
  return row;
}
export function enqueueMerchantWebhook(merchantId: string, eventType: string, eventId: string, payload: unknown): void {
  if (!db.prepare("SELECT id FROM platform_merchants WHERE id = ?").get(merchantId)) return;
  const timestamp = nowIso();
  db.prepare(`INSERT INTO merchant_webhook_deliveries (id, merchant_id, event_id, event_type, payload, status, attempts, next_retry_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?) ON CONFLICT(merchant_id, event_id) DO NOTHING`)
    .run(randomId("mhook"), merchantId, eventId, eventType, JSON.stringify(payload), timestamp, timestamp, timestamp);
}
export function listMerchantWebhookDeliveries(merchantId: string, limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`SELECT id, merchant_id AS merchantId, event_id AS eventId, event_type AS eventType, status, attempts, next_retry_at AS nextRetryAt, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt FROM merchant_webhook_deliveries WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?`).all(merchantId, safeLimit) as Array<Record<string, unknown>>;
}
export function listAllMerchantWebhookDeliveries(limit = 200, status?: string): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const filter = status ? " WHERE d.status = ?" : "";
  const values = status ? [status, safeLimit] : [safeLimit];
  return db.prepare(`SELECT d.id, d.merchant_id AS merchantId, p.code AS merchantCode, d.event_id AS eventId, d.event_type AS eventType, d.status, d.attempts, d.next_retry_at AS nextRetryAt, d.last_error AS lastError, d.created_at AS createdAt, d.updated_at AS updatedAt FROM merchant_webhook_deliveries d JOIN platform_merchants p ON p.id = d.merchant_id${filter} ORDER BY d.updated_at DESC LIMIT ?`).all(...values) as Array<Record<string, unknown>>;
}
export function requeueMerchantWebhookDelivery(id: string): Record<string, unknown> | undefined {
  db.prepare("UPDATE merchant_webhook_deliveries SET status = 'PENDING', next_retry_at = ?, last_error = NULL, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  return db.prepare("SELECT id, merchant_id AS merchantId, event_id AS eventId, event_type AS eventType, status, attempts, next_retry_at AS nextRetryAt, last_error AS lastError FROM merchant_webhook_deliveries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}
export function listRetryableMerchantWebhooks(limit = 50): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return db.prepare(`SELECT d.id, d.merchant_id AS merchantId, d.event_id AS eventId, d.event_type AS eventType, d.payload, d.status, d.attempts, d.next_retry_at AS nextRetryAt, d.last_error AS lastError, p.code AS merchantCode, w.url, w.secret, w.enabled FROM merchant_webhook_deliveries d JOIN merchant_webhooks w ON w.merchant_id = d.merchant_id JOIN platform_merchants p ON p.id = d.merchant_id WHERE d.status IN ('PENDING','RETRYING') AND d.next_retry_at <= ? AND d.attempts < 8 AND w.enabled = 1 ORDER BY d.next_retry_at LIMIT ?`).all(nowIso(), safeLimit).map((row) => { const item = row as Record<string, unknown>; item.secret = decryptSecret(String(item.secret)); return item; }) as Array<Record<string, unknown>>;
}
export function markMerchantWebhookSuccess(id: string): void { db.prepare("UPDATE merchant_webhook_deliveries SET status = 'SUCCESS', updated_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), id); }
export function markMerchantWebhookFailure(id: string, error: string, attempts: number): void { const status = attempts >= 8 ? "DEAD" : "RETRYING"; const next = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 1000)).toISOString(); db.prepare("UPDATE merchant_webhook_deliveries SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(status, attempts, next, error, nowIso(), id); }

export function createSettlementStatement(input: { merchantId: string; dateFrom: string; dateTo: string }): Record<string, unknown> {
  const merchant = db.prepare("SELECT settlement_rate AS rate FROM platform_merchants WHERE id = ? AND status = 'ACTIVE'").get(input.merchantId) as { rate: number } | undefined;
  if (!merchant) throw new Error("PLATFORM_MERCHANT_NOT_FOUND");
  const existing = db.prepare("SELECT id FROM settlement_statements WHERE merchant_id = ? AND date_from = ? AND date_to = ? AND status != 'VOID' ORDER BY created_at DESC LIMIT 1").get(input.merchantId, input.dateFrom, input.dateTo) as { id: string } | undefined;
  if (existing) return getSettlementStatement(existing.id)!;
  const rows = getSettlementReport({ dateFrom: input.dateFrom, dateTo: input.dateTo, platformMerchantId: input.merchantId });
  const grossAmount = rows.reduce((sum, row) => sum + Number(row.grossAmount), 0);
  const refundAmount = rows.reduce((sum, row) => sum + Number(row.refundAmount), 0);
  const feeAmount = Math.round((grossAmount - refundAmount) * Number(merchant.rate || 0) / 100);
  const netAmount = grossAmount - refundAmount - feeAmount;
  const id = randomId("settle");
  db.prepare(`INSERT INTO settlement_statements (id, merchant_id, date_from, date_to, gross_amount, refund_amount, fee_amount, net_amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`).run(id, input.merchantId, input.dateFrom, input.dateTo, grossAmount, refundAmount, feeAmount, netAmount, nowIso());
  try {
    appendMerchantLedger({ merchantId: input.merchantId, entryType: "SETTLEMENT_RESERVE", amount: 0, availableDelta: -netAmount, pendingDelta: netAmount, referenceType: "SETTLEMENT", referenceId: id, idempotencyKey: `settlement:${id}:reserve`, note: "结算单创建，冻结待结算金额" });
  } catch (error) {
    db.prepare("DELETE FROM settlement_statements WHERE id = ?").run(id);
    throw error;
  }
  return getSettlementStatement(id)!;
}
export function getSettlementStatement(id: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT s.id, s.merchant_id AS merchantId, p.code AS merchantCode, p.name AS merchantName, p.settlement_rate AS settlementRate,
    s.date_from AS dateFrom, s.date_to AS dateTo, s.gross_amount AS grossAmount, s.refund_amount AS refundAmount,
    s.fee_amount AS feeAmount, s.net_amount AS netAmount, s.status, s.note, s.payment_proof AS paymentProof, s.created_at AS createdAt,
    s.confirmed_at AS confirmedAt, s.paid_at AS paidAt FROM settlement_statements s JOIN platform_merchants p ON p.id = s.merchant_id WHERE s.id = ?`).get(id) as Record<string, unknown> | undefined;
}
export function getSettlementDifference(id: string): Record<string, unknown> | undefined {
  const statement = getSettlementStatement(id); if (!statement) return undefined;
  const report = getSettlementReport({ dateFrom: String(statement.dateFrom), dateTo: String(statement.dateTo), platformMerchantId: String(statement.merchantId) });
  const totals = report.reduce((sum: { grossAmount: number; refundAmount: number }, row) => ({ grossAmount: sum.grossAmount + Number(row.grossAmount || 0), refundAmount: sum.refundAmount + Number(row.refundAmount || 0) }), { grossAmount: 0, refundAmount: 0 });
  const feeAmount = Math.round((totals.grossAmount - totals.refundAmount) * Number(statement.settlementRate || 0) / 100);
  const calculated = { ...totals, feeAmount, netAmount: totals.grossAmount - totals.refundAmount - feeAmount };
  const ledger = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'ORDER_SUCCESS' THEN amount ELSE 0 END), 0) AS grossAmount,
      COALESCE(SUM(CASE WHEN entry_type = 'REFUND_SUCCESS' THEN ABS(amount) ELSE 0 END), 0) AS refundAmount
    FROM merchant_ledger_entries WHERE merchant_id = ? AND created_at >= ? AND created_at < ?`).get(statement.merchantId, statement.dateFrom, statement.dateTo) as Record<string, unknown>;
  const statementValues = { grossAmount: Number(statement.grossAmount || 0), refundAmount: Number(statement.refundAmount || 0), feeAmount: Number(statement.feeAmount || 0), netAmount: Number(statement.netAmount || 0) };
  const difference = { grossAmount: calculated.grossAmount - statementValues.grossAmount, refundAmount: calculated.refundAmount - statementValues.refundAmount, feeAmount: calculated.feeAmount - statementValues.feeAmount, netAmount: calculated.netAmount - statementValues.netAmount, ledgerGrossAmount: Number(ledger.grossAmount || 0) - calculated.grossAmount, ledgerRefundAmount: Number(ledger.refundAmount || 0) - calculated.refundAmount };
  const matched = Object.values(difference).every((value) => Number(value) === 0);
  return { statementId: id, merchantId: statement.merchantId, dateFrom: statement.dateFrom, dateTo: statement.dateTo, status: matched ? "MATCHED" : "DIFFERENCE", statement: statementValues, calculated, ledger: { grossAmount: Number(ledger.grossAmount || 0), refundAmount: Number(ledger.refundAmount || 0) }, difference, checkedAt: nowIso() };
}
export function listSettlementStatements(merchantId?: string, limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = merchantId
    ? db.prepare(`SELECT s.id, s.merchant_id AS merchantId, p.code AS merchantCode, p.name AS merchantName, s.date_from AS dateFrom, s.date_to AS dateTo, s.gross_amount AS grossAmount, s.refund_amount AS refundAmount, s.fee_amount AS feeAmount, s.net_amount AS netAmount, s.status, s.note, s.payment_proof AS paymentProof, s.created_at AS createdAt, s.confirmed_at AS confirmedAt, s.paid_at AS paidAt FROM settlement_statements s JOIN platform_merchants p ON p.id = s.merchant_id WHERE s.merchant_id = ? ORDER BY s.created_at DESC LIMIT ?`).all(merchantId, safeLimit)
    : db.prepare(`SELECT s.id, s.merchant_id AS merchantId, p.code AS merchantCode, p.name AS merchantName, s.date_from AS dateFrom, s.date_to AS dateTo, s.gross_amount AS grossAmount, s.refund_amount AS refundAmount, s.fee_amount AS feeAmount, s.net_amount AS netAmount, s.status, s.note, s.payment_proof AS paymentProof, s.created_at AS createdAt, s.confirmed_at AS confirmedAt, s.paid_at AS paidAt FROM settlement_statements s JOIN platform_merchants p ON p.id = s.merchant_id ORDER BY s.created_at DESC LIMIT ?`).all(safeLimit);
  return rows as Array<Record<string, unknown>>;
}
export function updateSettlementStatementStatus(id: string, status: "DRAFT" | "CONFIRMED" | "PAID" | "VOID", input: { note?: string; paymentProof?: string } = {}): Record<string, unknown> | undefined {
  const statement = getSettlementStatement(id); if (!statement) return undefined;
  const current = String(statement.status);
  const transitions: Record<string, string[]> = { DRAFT: ["CONFIRMED", "VOID"], CONFIRMED: ["PAID", "VOID"], PAID: [], VOID: [] };
  if (current !== status && !transitions[current]?.includes(status)) throw new Error("SETTLEMENT_STATUS_TRANSITION_INVALID");
  const now = nowIso();
  const result = db.prepare("UPDATE settlement_statements SET status = ?, note = COALESCE(?, note), payment_proof = COALESCE(?, payment_proof), confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END, paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, ?) ELSE paid_at END WHERE id = ? AND status = ?").run(status, input.note ?? null, input.paymentProof ?? null, status, now, status, now, id, current);
  if (result.changes !== 1) throw new Error("SETTLEMENT_CONCURRENT_UPDATE");
  const merchantId = String(statement.merchantId);
  const netAmount = Number(statement.netAmount);
  if (status === "PAID" && current !== "PAID") {
    appendMerchantLedger({ merchantId, entryType: "SETTLEMENT_PAID", amount: -netAmount, pendingDelta: -netAmount, referenceType: "SETTLEMENT", referenceId: id, idempotencyKey: `settlement:${id}:paid`, note: "结算单已付款" });
  } else if (status === "VOID" && current !== "VOID") {
    appendMerchantLedger({ merchantId, entryType: "SETTLEMENT_VOID", amount: 0, availableDelta: netAmount, pendingDelta: -netAmount, referenceType: "SETTLEMENT", referenceId: id, idempotencyKey: `settlement:${id}:void`, note: "结算单作废，释放待结算金额" });
  }
  return getSettlementStatement(id);
}

export interface ReconciliationRunInput {
  dateFrom: string;
  dateTo: string;
  channelId?: string;
}

function reconciliationWhere(input: ReconciliationRunInput): { sql: string; params: unknown[] } {
  const clauses = ["o.created_at >= ?", "o.created_at < ?"];
  const params: unknown[] = [input.dateFrom, input.dateTo];
  if (input.channelId) {
    clauses.push("o.channel_id = ?");
    params.push(input.channelId);
  }
  return { sql: clauses.join(" AND "), params };
}

export function createReconciliationRun(input: ReconciliationRunInput): Record<string, unknown> {
  const { sql, params } = reconciliationWhere(input);
  const rows = db.prepare(`
    SELECT o.id, o.platform_order_no AS platformOrderNo, o.channel_id AS channelId,
      o.amount, o.status, o.created_at AS createdAt, o.paid_at AS paidAt,
      COALESCE((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.status = 'SUCCESS'), 0) AS refundedAmount
    FROM orders o WHERE ${sql} ORDER BY o.created_at DESC
  `).all(...params) as Array<Record<string, unknown>>;
  type ReconciliationSummary = { orderCount: number; orderAmount: number; successCount: number; pendingCount: number; failedCount: number; closedCount: number; refundedOrderCount: number; refundAmount: number };
  const summary = rows.reduce<ReconciliationSummary>((result, row) => {
    const status = String(row.status);
    const amount = Number(row.amount);
    const refundedAmount = Number(row.refundedAmount);
    result.orderCount += 1;
    result.orderAmount += amount;
    result.refundAmount += refundedAmount;
    if (status === "SUCCESS") result.successCount += 1;
    else if (["CREATED", "ROUTED", "QR_CREATED", "PAYING", "UNKNOWN"].includes(status)) result.pendingCount += 1;
    else if (status === "FAILED") result.failedCount += 1;
    else if (status === "CLOSED") result.closedCount += 1;
    if (refundedAmount > 0) result.refundedOrderCount += 1;
    return result;
  }, { orderCount: 0, orderAmount: 0, successCount: 0, pendingCount: 0, failedCount: 0, closedCount: 0, refundedOrderCount: 0, refundAmount: 0 });
  const id = randomId("recon");
  const storedSummary = { ...summary, billImported: false, matchedCount: 0, externalOnlyCount: 0, localOnlyCount: summary.orderCount, amountMismatchCount: 0, statusMismatchCount: 0, refundMismatchCount: 0, netSettlementAmount: 0 };
  db.prepare(`INSERT INTO reconciliation_runs (id, date_from, date_to, channel_id, status, summary, created_at)
    VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)`)
    .run(id, input.dateFrom, input.dateTo, input.channelId ?? null, JSON.stringify(storedSummary), nowIso());
  return getReconciliationRun(id)!;
}

export interface ReconciliationBillItemInput {
  channelId?: string;
  outTradeNo?: string;
  transactionId?: string;
  amount: number;
  tradeState: string;
  refundAmount?: number;
  raw?: unknown;
}

export function importReconciliationBill(runId: string, items: ReconciliationBillItemInput[]): Record<string, unknown> {
  const run = getReconciliationRun(runId);
  if (!run) throw new Error("RECONCILIATION_RUN_NOT_FOUND");
  const runChannelId = run.channelId ? String(run.channelId) : undefined;
  // 重新导入同一批账单时保留人工差异处理结果，避免把已处理记录重置为 OPEN。
  const insert = db.prepare(`INSERT INTO reconciliation_bill_items
    (id, run_id, channel_id, out_trade_no, transaction_id, amount, trade_state, refund_amount, match_status, local_order_id, raw, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, out_trade_no, transaction_id) DO UPDATE SET
      channel_id = excluded.channel_id, amount = excluded.amount, trade_state = excluded.trade_state,
      refund_amount = excluded.refund_amount, match_status = excluded.match_status,
      local_order_id = excluded.local_order_id, raw = excluded.raw`);
  const tx = db.transaction(() => {
    for (const item of items) {
      if (runChannelId && item.channelId && runChannelId !== item.channelId) throw new Error("BILL_CHANNEL_MISMATCH");
      const channelId = item.channelId ?? runChannelId ?? null;
      const local = item.transactionId
        ? (channelId ? db.prepare("SELECT id, channel_id AS channelId, status, amount FROM orders WHERE channel_id = ? AND transaction_id = ? LIMIT 1").get(channelId, item.transactionId) : db.prepare("SELECT id, channel_id AS channelId, status, amount FROM orders WHERE transaction_id = ? LIMIT 1").get(item.transactionId)) as Record<string, unknown> | undefined
        : item.outTradeNo
          ? (channelId ? db.prepare("SELECT id, channel_id AS channelId, status, amount FROM orders WHERE channel_id = ? AND channel_out_trade_no = ? LIMIT 1").get(channelId, item.outTradeNo) : db.prepare("SELECT id, channel_id AS channelId, status, amount FROM orders WHERE channel_out_trade_no = ? LIMIT 1").get(item.outTradeNo)) as Record<string, unknown> | undefined
          : undefined;
      let matchStatus = "EXTERNAL_ONLY";
      if (local) {
        const amountMatches = Number(local.amount) === item.amount;
        const statusMatches = item.tradeState === "SUCCESS" ? local.status === "SUCCESS" : item.tradeState === String(local.status);
        const localRefund = Number((db.prepare("SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM refund_orders WHERE order_id = ? AND status = 'SUCCESS'").get(local.id) as { amount: number }).amount);
        const refundMatches = localRefund === Number(item.refundAmount ?? 0);
        matchStatus = !amountMatches ? "AMOUNT_MISMATCH" : !statusMatches ? "STATUS_MISMATCH" : !refundMatches ? "REFUND_MISMATCH" : "MATCHED";
      }
      insert.run(randomId("bill"), runId, channelId, item.outTradeNo ?? null, item.transactionId ?? null, item.amount, item.tradeState, item.refundAmount ?? 0, matchStatus, local?.id ?? null, JSON.stringify(item.raw ?? item), nowIso());
    }
  });
  tx();
  const billRows = db.prepare("SELECT match_status AS matchStatus, amount, refund_amount AS refundAmount, local_order_id AS localOrderId FROM reconciliation_bill_items WHERE run_id = ?").all(runId) as Array<Record<string, unknown>>;
  const base = JSON.parse(String((db.prepare("SELECT summary FROM reconciliation_runs WHERE id = ?").get(runId) as { summary: string }).summary));
  const localOnlyCount = Math.max(0, Number(base.orderCount) - new Set(billRows.map((row) => row.localOrderId).filter(Boolean)).size);
  const updated = {
    ...base,
    billImported: true,
    matchedCount: billRows.filter((row) => row.matchStatus === "MATCHED").length,
    externalOnlyCount: billRows.filter((row) => row.matchStatus === "EXTERNAL_ONLY").length,
    localOnlyCount,
    amountMismatchCount: billRows.filter((row) => row.matchStatus === "AMOUNT_MISMATCH").length,
    statusMismatchCount: billRows.filter((row) => row.matchStatus === "STATUS_MISMATCH").length,
    refundMismatchCount: billRows.filter((row) => row.matchStatus === "REFUND_MISMATCH").length,
    externalAmount: billRows.reduce((sum, row) => sum + Number(row.amount), 0),
    externalRefundAmount: billRows.reduce((sum, row) => sum + Number(row.refundAmount), 0),
    netSettlementAmount: billRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.refundAmount), 0)
  };
  db.prepare("UPDATE reconciliation_runs SET summary = ? WHERE id = ?").run(JSON.stringify(updated), runId);
  return getReconciliationRun(runId)!;
}

export function getReconciliationRun(id: string): Record<string, unknown> | undefined {
  const row = db.prepare(`SELECT id, date_from AS dateFrom, date_to AS dateTo, channel_id AS channelId,
    status, summary, created_at AS createdAt FROM reconciliation_runs WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const summary = JSON.parse(String(row.summary));
  const where = reconciliationWhere({ dateFrom: String(row.dateFrom), dateTo: String(row.dateTo), channelId: row.channelId ? String(row.channelId) : undefined });
  const items = db.prepare(`SELECT o.id AS localOrderId, o.platform_order_no AS platformOrderNo, o.channel_id AS channelId,
    o.amount, o.status, o.created_at AS createdAt, o.paid_at AS paidAt,
    COALESCE((SELECT SUM(r.refund_amount) FROM refund_orders r WHERE r.order_id = o.id AND r.status = 'SUCCESS'), 0) AS refundedAmount
    FROM orders o WHERE ${where.sql} ORDER BY o.created_at DESC LIMIT 500`).all(...where.params) as Array<Record<string, unknown>>;
  const bills = db.prepare(`SELECT id, channel_id AS channelId, out_trade_no AS outTradeNo, transaction_id AS transactionId,
    amount, trade_state AS tradeState, refund_amount AS refundAmount, match_status AS matchStatus, resolution_status AS resolutionStatus, resolution_note AS resolutionNote, resolved_by AS resolvedBy, resolved_at AS resolvedAt, local_order_id AS localOrderId, created_at AS createdAt
    FROM reconciliation_bill_items WHERE run_id = ? ORDER BY created_at DESC`).all(id) as Array<Record<string, unknown>>;
  const billByLocal = new Map(bills.filter((item) => item.localOrderId).map((item) => [String(item.localOrderId), item]));
  const localItems = items.map((item) => {
    const bill = billByLocal.get(String(item.localOrderId));
    const fallbackStatus = item.status === "SUCCESS" ? "MATCHED_LOCAL" : ["CREATED", "ROUTED", "QR_CREATED", "PAYING", "UNKNOWN"].includes(String(item.status)) ? "PENDING_QUERY" : "LOCAL_EXCEPTION";
    return { ...item, reconciliationItemId: bill?.id ?? null, reconciliationStatus: bill ? String(bill.matchStatus) : summary.billImported ? "LOCAL_ONLY" : fallbackStatus, externalAmount: bill?.amount ?? null, externalTradeState: bill?.tradeState ?? null };
  });
  const externalItems = bills.filter((item) => !item.localOrderId).map((item) => ({ ...item, reconciliationItemId: item.id, platformOrderNo: "-", status: item.tradeState, refundedAmount: item.refundAmount, reconciliationStatus: "EXTERNAL_ONLY" }));
  return { ...row, summary, items: [...localItems, ...externalItems], billItems: bills };
}

export function resolveReconciliationItem(itemId: string, operator: string, status: "RESOLVED" | "IGNORED", note: string): Record<string, unknown> | undefined {
  db.prepare("UPDATE reconciliation_bill_items SET resolution_status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?").run(status, note, operator, nowIso(), itemId);
  return db.prepare("SELECT id, run_id AS runId, match_status AS matchStatus, resolution_status AS resolutionStatus, resolution_note AS resolutionNote, resolved_by AS resolvedBy, resolved_at AS resolvedAt FROM reconciliation_bill_items WHERE id = ?").get(itemId) as Record<string, unknown> | undefined;
}

export function listReconciliationRuns(limit = 50): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  return db.prepare(`SELECT id, date_from AS dateFrom, date_to AS dateTo, channel_id AS channelId,
    status, summary, created_at AS createdAt FROM reconciliation_runs ORDER BY created_at DESC LIMIT ?`).all(safeLimit).map((row) => {
    const item = row as Record<string, unknown>;
    return { ...item, summary: JSON.parse(String(item.summary)) };
  }) as Array<Record<string, unknown>>;
}

/**
 * 订单、额度和退款账务的轻量巡检。只读，不会自动修复数据，供运营在发布和日常值守时确认。
 */
export function getDataConsistencyReport(): Record<string, unknown> {
  const checks = [
    {
      code: "SUCCESS_WITHOUT_PAID_AT", label: "成功订单缺少支付时间", severity: "HIGH",
      sql: "SELECT platform_order_no AS id FROM orders WHERE status = 'SUCCESS' AND paid_at IS NULL ORDER BY created_at DESC LIMIT 20"
    },
    {
      code: "FINAL_ORDER_WITH_RESERVATION", label: "终态订单仍占用额度预占", severity: "HIGH",
      sql: "SELECT o.platform_order_no AS id FROM orders o JOIN merchant_quota_reservations r ON r.order_id = o.id WHERE o.status IN ('SUCCESS','FAILED','CLOSED') AND r.status = 'RESERVED' ORDER BY o.created_at DESC LIMIT 20"
    },
    {
      code: "PENDING_WITHOUT_RESERVATION", label: "处理中订单缺少额度预占", severity: "MEDIUM",
      sql: "SELECT o.platform_order_no AS id FROM orders o JOIN platform_merchants pm ON pm.id = o.merchant_id LEFT JOIN merchant_quota_reservations r ON r.order_id = o.id AND r.status = 'RESERVED' WHERE o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN') AND pm.status = 'ACTIVE' AND r.id IS NULL ORDER BY o.created_at DESC LIMIT 20"
    },
    {
      code: "REFUND_EXCEEDS_ORDER", label: "退款累计金额超过订单金额", severity: "HIGH",
      sql: "SELECT o.platform_order_no AS id FROM orders o JOIN refund_orders r ON r.order_id = o.id WHERE r.approval_status != 'REJECTED' AND r.status NOT IN ('CLOSED','ABNORMAL') GROUP BY o.id HAVING SUM(r.refund_amount) > o.amount ORDER BY o.created_at DESC LIMIT 20"
    },
    {
      code: "SUCCESS_WITHOUT_LEDGER", label: "成功订单缺少码商收款流水", severity: "MEDIUM",
      sql: "SELECT o.platform_order_no AS id FROM orders o JOIN platform_merchants pm ON pm.id = o.merchant_id LEFT JOIN merchant_ledger_entries l ON l.reference_type = 'ORDER' AND l.reference_id = o.id AND l.entry_type = 'ORDER_SUCCESS' WHERE o.status = 'SUCCESS' AND pm.status != 'ARCHIVED' AND l.id IS NULL ORDER BY o.created_at DESC LIMIT 20"
    },
    {
      code: "PENDING_WITHOUT_ROUTE_RESERVATION", label: "处理中订单缺少路由容量预占", severity: "MEDIUM",
      sql: "SELECT o.platform_order_no AS id FROM orders o LEFT JOIN route_reservations r ON r.order_id = o.id AND r.status = 'RESERVED' WHERE o.status IN ('CREATED','ROUTED','QR_CREATED','PAYING','UNKNOWN') AND r.id IS NULL ORDER BY o.created_at DESC LIMIT 20"
    },
    {
      code: "FINAL_WITH_ROUTE_RESERVATION", label: "终态订单仍占用路由容量", severity: "HIGH",
      sql: "SELECT o.platform_order_no AS id FROM orders o JOIN route_reservations r ON r.order_id = o.id WHERE o.status IN ('SUCCESS','FAILED','CLOSED') AND r.status = 'RESERVED' ORDER BY o.created_at DESC LIMIT 20"
    }
  ];
  const results = checks.map((check) => {
    const rows = db.prepare(check.sql).all() as Array<{ id: string }>;
    return { code: check.code, label: check.label, severity: check.severity, count: rows.length, sampleIds: rows.map((row) => row.id) };
  });
  return { checkedAt: nowIso(), issueCount: results.reduce((sum, item) => sum + Number(item.count), 0), highCount: results.filter((item) => item.severity === "HIGH" && Number(item.count) > 0).length, checks: results };
}

function weightedChannel(channels: Channel[]): Channel {
  if (!channels.length) throw new Error("NO_ACTIVE_CHANNEL");
  const totalWeight = channels.reduce((sum, channel) => sum + Math.max(channel.routeWeight, 1), 0);
  let cursor = Math.floor(Math.random() * totalWeight);
  for (const channel of channels) {
    cursor -= Math.max(channel.routeWeight, 1);
    if (cursor < 0) return channel;
  }
  return channels[channels.length - 1];
}

export interface RoutedPaymentTarget extends Channel {
  platformMerchantId?: string;
  routeRuleId?: string;
  routeSnapshot?: Record<string, unknown>;
}

function merchantChannelRouteStrategy(platformMerchantId: string | undefined, channelId: string, clientMerchantId?: string): MerchantRouteStrategy {
  const row = clientMerchantId
    ? db.prepare("SELECT route_strategy AS routeStrategy FROM client_merchant_channels WHERE client_merchant_id = ? AND channel_id = ? AND status = 'ACTIVE'").get(clientMerchantId, channelId) as { routeStrategy?: string } | undefined
    : undefined;
  const channelRow = row || db.prepare("SELECT route_strategy AS routeStrategy FROM channels WHERE id = ?").get(channelId) as { routeStrategy?: string } | undefined;
  const strategy = String(channelRow?.routeStrategy || "HEALTH_WEIGHTED");
  return strategy === "ROUND_ROBIN" || strategy === "FAILOVER" ? strategy : "HEALTH_WEIGHTED";
}

function nextMerchantChannelRoundRobinIndex(platformMerchantId: string | undefined, channelId: string, candidateCount: number, clientMerchantId?: string): number {
  if (candidateCount <= 0) return 0;
  const tx = db.transaction(() => {
    const timestamp = nowIso();
    const row = clientMerchantId
      ? db.prepare("SELECT route_cursor AS routeCursor FROM client_merchant_channels WHERE client_merchant_id = ? AND channel_id = ? AND status = 'ACTIVE'").get(clientMerchantId, channelId) as { routeCursor?: number } | undefined
      : undefined;
    const channelRow = row || db.prepare("SELECT route_cursor AS routeCursor FROM channels WHERE id = ?").get(channelId) as { routeCursor?: number } | undefined;
    const cursor = Number(channelRow?.routeCursor || 0);
    if (clientMerchantId && row) db.prepare("UPDATE client_merchant_channels SET route_cursor = route_cursor + 1 WHERE client_merchant_id = ? AND channel_id = ?").run(clientMerchantId, channelId);
    else db.prepare("UPDATE channels SET route_cursor = route_cursor + 1 WHERE id = ?").run(channelId);
    return cursor % candidateCount;
  });
  return tx();
}

function cleanupExpiredRouteReservations(): void {
  db.prepare(`UPDATE route_reservations SET status = 'RELEASED', released_at = ?
    WHERE status = 'RESERVED' AND order_id IN (SELECT id FROM orders WHERE status IN ('FAILED','CLOSED') OR (status NOT IN ('SUCCESS') AND expire_at < ?))`).run(nowIso(), nowIso());
}

function routeMerchantCandidates(channelId: string, amount: number, preferredPlatformMerchantId?: string, clientMerchantId?: string, excludedTargetKeys?: Set<string>): Array<RoutedPaymentTarget> {
  const channel = getChannel(channelId); if (!channel) return [];
  const authorizedRows = listChannelPlatformMerchants(channelId);
  const policyRows = authorizedRows.filter((row) => String(row.policyStatus || 'ACTIVE') === 'ACTIVE' && String(row.status) === 'ACTIVE' && (!preferredPlatformMerchantId || String(row.id) === preferredPlatformMerchantId));
  const preferredExists = preferredPlatformMerchantId ? Boolean(db.prepare("SELECT id FROM platform_merchants WHERE id = ? AND status = 'ACTIVE'").get(preferredPlatformMerchantId)) : false;
  const platformRows = authorizedRows.length ? policyRows : preferredExists ? [{ id: preferredPlatformMerchantId, routeWeight: 100, maxConcurrency: 0, dailyAmountLimit: 0, dailyOrderLimit: 0, policyStatus: 'ACTIVE', status: 'ACTIVE' }] : [{ id: undefined, routeWeight: 100, maxConcurrency: 0, dailyAmountLimit: 0, dailyOrderLimit: 0, policyStatus: 'ACTIVE', status: 'ACTIVE' }];
  const result: Array<RoutedPaymentTarget> = [];
  for (const platform of platformRows) {
    const platformId = platform.id ? String(platform.id) : undefined;
    if (clientMerchantId) {
      const hasChannelBindings = Number((db.prepare("SELECT COUNT(*) AS count FROM client_merchant_channels WHERE client_merchant_id = ? AND status = 'ACTIVE'").get(clientMerchantId) as { count: number }).count || 0) > 0;
      if (hasChannelBindings && !db.prepare("SELECT 1 FROM client_merchant_channels WHERE client_merchant_id = ? AND channel_id = ? AND status = 'ACTIVE'").get(clientMerchantId, channelId)) continue;
    }
    const policy = platform as Record<string, unknown>;
    let bindings = platformId ? listPlatformMerchantWechatBindings(platformId) : [];
    if (!platformId) bindings = listChannelMerchants(channelId).map((row) => ({ ...row, status: row.bindingStatus, routeWeight: row.routeWeight, maxConcurrency: 0 }));
    for (const binding of bindings) {
      const merchantId = String(binding.id || binding.wechatMerchantId || binding.merchantId || ''); if (!merchantId || String(binding.status || 'ACTIVE') !== 'ACTIVE' || String(binding.merchantStatus || 'ACTIVE') !== 'ACTIVE') continue;
      const targetKey = `${channelId}:${platformId ?? ''}:${merchantId}`; if (excludedTargetKeys?.has(targetKey)) continue;
      if (!db.prepare("SELECT 1 FROM channel_merchant_bindings WHERE channel_id = ? AND merchant_id = ? AND binding_status = 'ACTIVE'").get(channelId, merchantId)) continue;
      const min = Number(binding.minOrderAmount || 1); const max = Number(binding.maxOrderAmount || 0); if (amount < min || (max > 0 && amount > max)) continue;
      const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const merchantDailyLimit = Number(binding.merchantDailyAmountLimit || 0);
      const bindingDailyLimit = Number(binding.dailyAmountLimit || 0);
      const policyDailyLimit = Number(policy.dailyAmountLimit || 0);
      const configuredDailyLimits = [merchantDailyLimit, bindingDailyLimit, policyDailyLimit].filter((value) => value > 0);
      const dailyAmountLimit = configuredDailyLimits.length ? Math.min(...configuredDailyLimits) : 0;
      const merchantDailyOrderLimit = Number(binding.merchantDailyOrderLimit || 0);
      const bindingDailyOrderLimit = Number(binding.dailyOrderLimit || 0);
      const policyDailyOrderLimit = Number(policy.dailyOrderLimit || 0);
      const configuredDailyOrderLimits = [merchantDailyOrderLimit, bindingDailyOrderLimit, policyDailyOrderLimit].filter((value) => value > 0);
      const dailyOrderLimit = configuredDailyOrderLimits.length ? Math.min(...configuredDailyOrderLimits) : 0;
      const dailySuccessLimit = Number(binding.dailySuccessLimit || 0);
      const orderWindowSeconds = Number(binding.orderWindowSeconds || 0);
      const orderWindowLimit = Number(binding.orderWindowLimit || 0);
      const riskEnabled = Number(binding.riskEnabled ?? 1) !== 0;
      const usage = db.prepare("SELECT COUNT(*) AS orderCount, COALESCE(SUM(amount),0) AS amount FROM orders WHERE channel_id = ? AND wechat_merchant_id = ? AND status = 'SUCCESS' AND date(created_at, '+8 hours') = ?").get(channelId, merchantId, day) as { orderCount: number; amount: number };
      const merchantUsage = db.prepare("SELECT COUNT(*) AS orderCount, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successCount FROM orders WHERE wechat_merchant_id = ? AND status NOT IN ('FAILED', 'CLOSED') AND date(created_at, '+8 hours') = ?").get(merchantId, day) as { orderCount: number; successCount: number };
      const windowUsage = orderWindowSeconds > 0 ? Number((db.prepare("SELECT COUNT(*) AS count FROM orders WHERE wechat_merchant_id = ? AND status NOT IN ('FAILED', 'CLOSED') AND created_at >= ?").get(merchantId, new Date(Date.now() - orderWindowSeconds * 1000).toISOString()) as { count: number }).count) : 0;
      if (dailyAmountLimit > 0 && Number(usage.amount) + amount > dailyAmountLimit) continue; if (riskEnabled && dailyOrderLimit > 0 && Number(merchantUsage.orderCount || 0) >= dailyOrderLimit) continue; if (riskEnabled && dailySuccessLimit > 0 && Number(merchantUsage.successCount || 0) >= dailySuccessLimit) continue; if (riskEnabled && orderWindowSeconds > 0 && orderWindowLimit > 0 && windowUsage >= orderWindowLimit) continue;
      const activeChannel = Number((db.prepare("SELECT COUNT(*) AS count FROM route_reservations WHERE channel_id = ? AND status = 'RESERVED'").get(channelId) as { count: number }).count);
      const activePlatform = platformId ? Number((db.prepare("SELECT COUNT(*) AS count FROM route_reservations WHERE platform_merchant_id = ? AND status = 'RESERVED'").get(platformId) as { count: number }).count) : 0;
      const activeWechat = Number((db.prepare("SELECT COUNT(*) AS count FROM route_reservations WHERE wechat_merchant_id = ? AND status = 'RESERVED'").get(merchantId) as { count: number }).count);
      const maxConcurrency = Number(binding.maxConcurrency || 0) || Number(policy.maxConcurrency || 0); if (maxConcurrency > 0 && activeWechat >= maxConcurrency) continue;
      result.push({ ...channel, appInternalId: String(binding.appInternalId || channel.appInternalId || ''), appId: String(binding.appId || channel.appId || ''), appStatus: String(binding.appStatus || 'ACTIVE'), merchantInternalId: merchantId, platformMerchantId: platformId, mchId: String(binding.mchid), credentialRef: String(binding.credentialRef), merchantStatus: String(binding.merchantStatus || 'ACTIVE'), routeWeight: Number(binding.routeWeight || policy.routeWeight || channel.routeWeight || 100), routeSnapshot: { channelId, amount, platformMerchantId: platformId, wechatMerchantId: merchantId, routeWeight: Number(binding.routeWeight || policy.routeWeight || channel.routeWeight || 100), maxConcurrency, riskEnabled, dailyAmountLimit, dailyOrderLimit, dailySuccessLimit, orderWindowSeconds, orderWindowLimit, activeChannel, activePlatform, activeWechat } });
    }
  }
  return result;
}

export function chooseRoutedPaymentTarget(amount = 0, allowedChannelIds?: string[], clientMerchantId?: string, preferredPlatformMerchantId?: string, excludedTargetKeys?: Set<string>, paymentMethod: ChannelPaymentMethod = "NATIVE"): RoutedPaymentTarget {
  cleanupExpiredRouteReservations();
  const allowed = allowedChannelIds ? new Set(allowedChannelIds) : undefined;
  const baseChannels = listChannels().filter((channel) => (!allowed || allowed.has(channel.id)) && (channel.paymentMethod || "NATIVE") === paymentMethod && channel.status === 'ACTIVE' && Boolean(getChannelPreflight(channel.id)?.ready) && (db.prepare("SELECT COALESCE(circuit_state, 'CLOSED') AS state FROM channel_health WHERE channel_id = ?").get(channel.id) as { state: string } | undefined)?.state !== 'OPEN');
  const rules = listRouteRules().filter((rule) => { if (rule.status !== 'ACTIVE') return false; const min = rule.amountMin == null ? 0 : Number(rule.amountMin); const max = rule.amountMax == null ? Number.MAX_SAFE_INTEGER : Number(rule.amountMax); return amount >= min && amount <= max; });
  const recentSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const channelHealthFactor = (channel: Channel): { factor: number; sampleSize: number; successRate: number | null; failureRate: number | null } => {
    const health = db.prepare("SELECT consecutive_failures AS failures, circuit_state AS state FROM channel_health WHERE channel_id = ?").get(channel.id) as { failures?: number; state?: string } | undefined;
    const metrics = db.prepare(`SELECT
      COUNT(CASE WHEN status IN ('SUCCESS', 'FAILED', 'CLOSED', 'UNKNOWN') THEN 1 END) AS sampleSize,
      COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) AS successCount,
      COUNT(CASE WHEN status IN ('FAILED', 'CLOSED', 'UNKNOWN') THEN 1 END) AS failureCount
      FROM orders WHERE channel_id = ? AND created_at >= ?`).get(channel.id, recentSince) as { sampleSize?: number; successCount?: number; failureCount?: number };
    const sampleSize = Number(metrics?.sampleSize || 0);
    const successCount = Number(metrics?.successCount || 0);
    const failureCount = Number(metrics?.failureCount || 0);
    const successRate = sampleSize ? successCount / sampleSize : null;
    const failureRate = sampleSize ? failureCount / sampleSize : null;
    const observedFactor = sampleSize >= 5 && failureRate != null ? Math.max(0.25, 1 - failureRate * 0.75) : 1;
    const consecutiveFailures = Number(health?.failures || 0);
    const failureFactor = Math.max(0.25, 1 / (1 + consecutiveFailures * 0.5));
    const halfOpenFactor = health?.state === 'HALF_OPEN' ? 0.2 : 1;
    return { factor: observedFactor * failureFactor * halfOpenFactor, sampleSize, successRate, failureRate };
  };
  const tryChannels = (channels: Channel[], ruleId?: string): RoutedPaymentTarget | undefined => {
    const candidates: RoutedPaymentTarget[] = [];
    for (const channel of channels) {
      const health = channelHealthFactor(channel);
      const targets = routeMerchantCandidates(channel.id, amount, preferredPlatformMerchantId, clientMerchantId, excludedTargetKeys);
      for (const target of targets) {
        const baseWeight = Number(target.routeWeight || channel.routeWeight || 100);
        const effectiveWeight = Math.max(1, Math.round(baseWeight * health.factor));
        candidates.push({ ...target, routeWeight: effectiveWeight, routeSnapshot: { ...(target.routeSnapshot || {}), routeHealthFactor: Number(health.factor.toFixed(4)), recentSampleSize: health.sampleSize, recentSuccessRate: health.successRate == null ? null : Number(health.successRate.toFixed(4)), recentFailureRate: health.failureRate == null ? null : Number(health.failureRate.toFixed(4)), effectiveRouteWeight: effectiveWeight, routeStrategy: merchantChannelRouteStrategy(target.platformMerchantId, target.id, clientMerchantId) } });
      }
    }
    if (!candidates.length) return undefined;
    const groups = new Map<string, { channelId: string; platformMerchantId?: string; strategy: MerchantRouteStrategy; targets: RoutedPaymentTarget[]; weight: number }>();
    for (const candidate of candidates) {
      const platformId = candidate.platformMerchantId;
      const key = `${candidate.id}:${platformId || ''}`;
      const existing = groups.get(key);
      if (existing) { existing.targets.push(candidate); existing.weight += Math.max(1, Number(candidate.routeWeight || 1)); }
      else groups.set(key, { channelId: candidate.id, platformMerchantId: platformId, strategy: merchantChannelRouteStrategy(platformId, candidate.id, clientMerchantId), targets: [candidate], weight: Math.max(1, Number(candidate.routeWeight || 1)) });
    }
    const groupList = [...groups.values()];
    const totalWeight = groupList.reduce((sum, group) => sum + group.weight, 0);
    let cursor = Math.floor(Math.random() * totalWeight);
    let selectedGroup = groupList[groupList.length - 1];
    for (const group of groupList) { cursor -= group.weight; if (cursor < 0) { selectedGroup = group; break; } }
    let selected: RoutedPaymentTarget;
    if (selectedGroup.strategy === "ROUND_ROBIN") {
      const index = nextMerchantChannelRoundRobinIndex(selectedGroup.platformMerchantId, selectedGroup.channelId, selectedGroup.targets.length, clientMerchantId);
      selected = selectedGroup.targets[index];
    } else if (selectedGroup.strategy === "FAILOVER") {
      selected = [...selectedGroup.targets].sort((left, right) => Number(right.routeWeight || 0) - Number(left.routeWeight || 0))[0];
    } else {
      selected = weightedChannel(selectedGroup.targets as Channel[]) as RoutedPaymentTarget;
    }
    selected.routeSnapshot = { ...(selected.routeSnapshot || {}), routeStrategy: selectedGroup.strategy };
    selected.routeRuleId = ruleId;
    if (selected.routeSnapshot) selected.routeSnapshot.ruleId = ruleId;
    return selected;
  };
  for (const rule of rules) { const ids = Array.isArray(rule.channelIds) ? rule.channelIds as string[] : []; const candidates = ids.length ? baseChannels.filter((channel) => ids.includes(channel.id)) : baseChannels; const selected = tryChannels(candidates, String(rule.id)); if (selected) return selected; }
  const selected = tryChannels(baseChannels); if (selected) return selected;
  throw new Error('NO_ROUTE_TARGET_AVAILABLE');
}

export function reserveRouteCapacity(orderId: string, target: RoutedPaymentTarget): void {
  const snapshot = target.routeSnapshot || {};
  const tx = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM route_reservations WHERE order_id = ? AND status = 'RESERVED'").get(orderId); if (existing) return;
    const channelCount = Number((db.prepare("SELECT COUNT(*) AS count FROM route_reservations WHERE channel_id = ? AND status = 'RESERVED'").get(target.id) as { count: number }).count);
    const activeChannelLimit = Number((snapshot as Record<string, unknown>).channelMaxConcurrency || 0); if (activeChannelLimit > 0 && channelCount >= activeChannelLimit) throw new Error('CHANNEL_CONCURRENCY_LIMIT');
    const platformId = target.platformMerchantId || null; const wechatId = target.merchantInternalId || null; const maxConcurrency = Number((snapshot as Record<string, unknown>).maxConcurrency || 0);
    if (maxConcurrency > 0 && wechatId && Number((db.prepare("SELECT COUNT(*) AS count FROM route_reservations WHERE wechat_merchant_id = ? AND status = 'RESERVED'").get(wechatId) as { count: number }).count) >= maxConcurrency) throw new Error('MERCHANT_CONCURRENCY_LIMIT');
    const dailyAmountLimit = Number((snapshot as Record<string, unknown>).dailyAmountLimit || 0); const dailyOrderLimit = Number((snapshot as Record<string, unknown>).dailyOrderLimit || 0); const dailySuccessLimit = Number((snapshot as Record<string, unknown>).dailySuccessLimit || 0); const orderWindowSeconds = Number((snapshot as Record<string, unknown>).orderWindowSeconds || 0); const orderWindowLimit = Number((snapshot as Record<string, unknown>).orderWindowLimit || 0);
    const riskEnabled = (snapshot as Record<string, unknown>).riskEnabled !== false && Number((snapshot as Record<string, unknown>).riskEnabled ?? 1) !== 0;
    if ((dailyAmountLimit > 0 || (riskEnabled && (dailyOrderLimit > 0 || dailySuccessLimit > 0 || (orderWindowSeconds > 0 && orderWindowLimit > 0)))) && wechatId) {
      const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const success = db.prepare("SELECT COUNT(*) AS orderCount, COALESCE(SUM(amount), 0) AS amount FROM orders WHERE wechat_merchant_id = ? AND status = 'SUCCESS' AND date(created_at, '+8 hours') = ?").get(wechatId, day) as { orderCount: number; amount: number };
      const activeOrders = db.prepare("SELECT COUNT(*) AS orderCount FROM orders WHERE wechat_merchant_id = ? AND id != ? AND status NOT IN ('FAILED', 'CLOSED') AND date(created_at, '+8 hours') = ?").get(wechatId, orderId, day) as { orderCount: number };
      const reserved = db.prepare("SELECT COUNT(*) AS orderCount, COALESCE(SUM(amount), 0) AS amount FROM route_reservations WHERE wechat_merchant_id = ? AND status = 'RESERVED' AND date(reserved_at, '+8 hours') = ?").get(wechatId, day) as { orderCount: number; amount: number };
      const windowOrders = orderWindowSeconds > 0 ? Number((db.prepare("SELECT COUNT(*) AS count FROM orders WHERE wechat_merchant_id = ? AND id != ? AND status NOT IN ('FAILED', 'CLOSED') AND created_at >= ?").get(wechatId, orderId, new Date(Date.now() - orderWindowSeconds * 1000).toISOString()) as { count: number }).count) : 0;
      if (dailyAmountLimit > 0 && Number(success.amount) + Number(reserved.amount) + Number((snapshot as Record<string, unknown>).amount || 0) > dailyAmountLimit) throw new Error('DAILY_AMOUNT_LIMIT_EXCEEDED');
      if (riskEnabled && dailyOrderLimit > 0 && Number(activeOrders.orderCount) >= dailyOrderLimit) throw new Error('DAILY_ORDER_LIMIT_EXCEEDED');
      if (riskEnabled && dailySuccessLimit > 0 && Number(success.orderCount) >= dailySuccessLimit) throw new Error('DAILY_SUCCESS_LIMIT_EXCEEDED');
      if (riskEnabled && orderWindowSeconds > 0 && orderWindowLimit > 0 && windowOrders >= orderWindowLimit) throw new Error('ORDER_WINDOW_LIMIT_EXCEEDED');
    }
    const now = nowIso(); db.prepare("INSERT INTO route_reservations (id, order_id, channel_id, platform_merchant_id, wechat_merchant_id, rule_id, amount, status, snapshot, reserved_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)").run(randomId('route'), orderId, target.id, platformId, wechatId, target.routeRuleId ?? null, Number((snapshot as Record<string, unknown>).amount || 0) || 0, JSON.stringify(snapshot), now);
    db.prepare("INSERT OR REPLACE INTO route_allocations (id, order_id, channel_id, platform_merchant_id, wechat_merchant_id, rule_id, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomId('alloc'), orderId, target.id, platformId, wechatId, target.routeRuleId ?? null, JSON.stringify(snapshot), now);
  }); tx();
}
export function reassignOrderRoute(orderId: string, target: RoutedPaymentTarget, channelOutTradeNo: string): void {
  const order = getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status !== "CREATED") throw new Error("ORDER_ROUTE_REASSIGN_INVALID_STATUS");
  const snapshot = target.routeSnapshot || {};
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("UPDATE route_reservations SET status = 'RELEASED', released_at = ? WHERE order_id = ? AND status = 'RESERVED'").run(now, orderId);
    db.prepare(`UPDATE orders SET channel_id = ?, wechat_merchant_id = ?, channel_out_trade_no = ?, route_rule_id = ?, route_snapshot = ?, route_selected_at = ? WHERE id = ?`)
      .run(target.id, target.merchantInternalId ?? null, channelOutTradeNo, target.routeRuleId ?? null, JSON.stringify(snapshot), now, orderId);
    db.prepare("INSERT OR REPLACE INTO route_allocations (id, order_id, channel_id, platform_merchant_id, wechat_merchant_id, rule_id, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomId("alloc"), orderId, target.id, target.platformMerchantId ?? null, target.merchantInternalId ?? null, target.routeRuleId ?? null, JSON.stringify(snapshot), now);
  });
  tx();
}
export function releaseRouteCapacity(orderId: string): void { db.prepare("UPDATE route_reservations SET status = 'RELEASED', released_at = ? WHERE order_id = ? AND status = 'RESERVED'").run(nowIso(), orderId); }
export function consumeRouteCapacity(orderId: string): void { db.prepare("UPDATE route_reservations SET status = 'CONSUMED', released_at = ? WHERE order_id = ? AND status = 'RESERVED'").run(nowIso(), orderId); }
export function getRouteAllocation(orderId: string): Record<string, unknown> | undefined { const row = db.prepare("SELECT id, order_id AS orderId, channel_id AS channelId, platform_merchant_id AS platformMerchantId, wechat_merchant_id AS wechatMerchantId, rule_id AS ruleId, snapshot, created_at AS createdAt FROM route_allocations WHERE order_id = ?").get(orderId) as Record<string, unknown> | undefined; if (!row) return undefined; try { row.snapshot = JSON.parse(String(row.snapshot)); } catch { /* keep raw snapshot */ } const reservation = db.prepare("SELECT status, reserved_at AS reservedAt, released_at AS releasedAt FROM route_reservations WHERE order_id = ? ORDER BY reserved_at DESC LIMIT 1").get(orderId) as Record<string, unknown> | undefined; return { ...row, status: reservation?.status || "NOT_RESERVED", reservedAt: reservation?.reservedAt, releasedAt: reservation?.releasedAt }; }

export function chooseChannel(amount = 0, allowedChannelIds?: string[], platformMerchantId?: string): Channel {
  const allowed = allowedChannelIds ? new Set(allowedChannelIds) : undefined;
  const merchantSettings = platformMerchantId ? new Map(listMerchantChannelSettings(platformMerchantId).map((item) => [String(item.id), item])) : undefined;
  const channels = listChannels().filter((channel) => (!allowed || allowed.has(channel.id)) && channel.status === "ACTIVE" && channel.appStatus !== "DISABLED" && channel.merchantStatus !== "DISABLED" && (!merchantSettings || Number(merchantSettings.get(channel.id)?.enabled ?? 1) === 1) && (db.prepare("SELECT COALESCE(circuit_state, 'CLOSED') AS state FROM channel_health WHERE channel_id = ?").get(channel.id) as { state: string } | undefined)?.state !== "OPEN").map((channel) => merchantSettings?.has(channel.id) ? { ...channel, routeWeight: Number(merchantSettings.get(channel.id)?.routeWeight ?? channel.routeWeight) } : channel);
  const rules = listRouteRules().filter((rule) => {
    if (rule.status !== "ACTIVE") return false;
    const min = rule.amountMin == null ? 0 : Number(rule.amountMin);
    const max = rule.amountMax == null ? Number.MAX_SAFE_INTEGER : Number(rule.amountMax);
    return amount >= min && amount <= max;
  });
  for (const rule of rules) {
    const ids = Array.isArray(rule.channelIds) ? rule.channelIds as string[] : [];
    const candidates = ids.length ? channels.filter((channel) => ids.includes(channel.id)) : channels;
    if (candidates.length) return selectChannelMerchant(weightedChannel(candidates).id, amount) || weightedChannel(candidates);
  }
  const selected = weightedChannel(channels);
  return selectChannelMerchant(selected.id, amount) || selected;
}

export interface CreateOrderInput {
  merchantId: string;
  clientMerchantId?: string | null;
  platformOrderNo: string;
  channelId: string;
  wechatMerchantId?: string | null;
  channelOutTradeNo: string;
  amount: number;
  description: string;
  paymentMethod?: "NATIVE" | "JSAPI";
  collectionMode?: "NATIVE" | "QR";
  paymentAppId?: string | null;
  paymentOpenid?: string | null;
  clientRequestNo: string;
  userId?: string | null;
  expireAt: string;
  routeRuleId?: string | null;
  routeSnapshot?: Record<string, unknown> | null;
  routeSelectedAt?: string | null;
  deviceType?: string | null;
  deviceIp?: string | null;
  deviceCountry?: string | null;
  deviceProvince?: string | null;
  deviceCity?: string | null;
  deviceNo?: string | null;
}

export function insertOrder(input: CreateOrderInput): void {
  const id = randomId("ord");
  db.prepare(`INSERT INTO orders
    (id, merchant_id, client_merchant_id, platform_order_no, channel_id, wechat_merchant_id, channel_out_trade_no, amount, description, status, payment_method, collection_mode, payment_app_id, payment_openid_hash, client_request_no, user_id, expire_at, route_rule_id, route_snapshot, route_selected_at, device_type, device_ip, device_country, device_province, device_city, device_no, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.merchantId, input.clientMerchantId ?? null, input.platformOrderNo, input.channelId, input.wechatMerchantId ?? null, input.channelOutTradeNo,
      input.amount, input.description, "CREATED", input.paymentMethod ?? "NATIVE", input.collectionMode ?? "NATIVE", input.paymentAppId ?? null, input.paymentOpenid ? crypto.createHash("sha256").update(input.paymentOpenid, "utf8").digest("hex") : null, input.clientRequestNo, input.userId ?? null, input.expireAt, input.routeRuleId ?? null, input.routeSnapshot ? JSON.stringify(input.routeSnapshot) : null, input.routeSelectedAt ?? nowIso(), input.deviceType ?? null, input.deviceIp ?? null, input.deviceCountry ?? null, input.deviceProvince ?? null, input.deviceCity ?? null, input.deviceNo ?? null, nowIso());
  recordOrderEvent(id, "CREATED", null, "CREATED", { source: "ORDER_CREATE" });
}

export function recordOrderEvent(orderId: string, eventType: string, fromStatus: string | null, toStatus: string | null, detail: Record<string, unknown> = {}): void {
  db.prepare("INSERT INTO order_events (id, order_id, event_type, from_status, to_status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(randomId("oevent"), orderId, eventType, fromStatus, toStatus, JSON.stringify(detail), nowIso());
}

export function getOrder(idOrPlatformNo: string): Order | undefined {
  const row = db.prepare(`
    SELECT id, merchant_id AS merchantId, platform_order_no AS platformOrderNo,
      channel_id AS channelId, wechat_merchant_id AS wechatMerchantId, client_merchant_id AS clientMerchantId, channel_out_trade_no AS channelOutTradeNo,
      amount, description, status, payment_method AS paymentMethod, collection_mode AS collectionMode, payment_app_id AS paymentAppId, code_url AS codeUrl, qr_data_url AS qrDataUrl,
      transaction_id AS transactionId, client_request_no AS clientRequestNo, user_id AS userId, payment_openid_hash AS paymentOpenidHash,
      expire_at AS expireAt, route_rule_id AS routeRuleId, route_snapshot AS routeSnapshot, route_selected_at AS routeSelectedAt, created_at AS createdAt, paid_at AS paidAt,
      device_type AS deviceType, device_ip AS deviceIp, device_country AS deviceCountry, device_province AS deviceProvince, device_city AS deviceCity, device_no AS deviceNo
    FROM orders WHERE id = ? OR platform_order_no = ?
  `).get(idOrPlatformNo, idOrPlatformNo) as Order | undefined;
  if (row && typeof row.routeSnapshot === "string") { try { row.routeSnapshot = JSON.parse(row.routeSnapshot); } catch { /* preserve malformed snapshot for diagnostics */ } }
  return row;
}

export function findOrderByClientRequest(merchantId: string, clientRequestNo: string): Order | undefined {
  const row = db.prepare(`
    SELECT id, merchant_id AS merchantId, platform_order_no AS platformOrderNo,
      channel_id AS channelId, wechat_merchant_id AS wechatMerchantId, client_merchant_id AS clientMerchantId, channel_out_trade_no AS channelOutTradeNo,
      amount, description, status, payment_method AS paymentMethod, collection_mode AS collectionMode, payment_app_id AS paymentAppId, code_url AS codeUrl, qr_data_url AS qrDataUrl,
      transaction_id AS transactionId, client_request_no AS clientRequestNo, user_id AS userId, payment_openid_hash AS paymentOpenidHash,
      expire_at AS expireAt, route_rule_id AS routeRuleId, route_snapshot AS routeSnapshot, route_selected_at AS routeSelectedAt, created_at AS createdAt, paid_at AS paidAt,
      device_type AS deviceType, device_ip AS deviceIp, device_country AS deviceCountry, device_province AS deviceProvince, device_city AS deviceCity, device_no AS deviceNo
    FROM orders WHERE merchant_id = ? AND client_request_no = ?
  `).get(merchantId, clientRequestNo) as Order | undefined;
  if (row && typeof row.routeSnapshot === "string") { try { row.routeSnapshot = JSON.parse(row.routeSnapshot); } catch { /* preserve malformed snapshot for diagnostics */ } }
  return row;
}

export function updateOrderPayment(id: string, values: { status?: OrderStatus; codeUrl?: string; qrDataUrl?: string; transactionId?: string; }): void {
  const current = getOrder(id);
  if (!current) throw new Error("ORDER_NOT_FOUND");
  const status = values.status ?? current.status;
  const allowed: Record<OrderStatus, OrderStatus[]> = {
    CREATED: ["CREATED", "ROUTED", "QR_CREATED", "PAYING", "SUCCESS", "FAILED", "UNKNOWN", "CLOSED"],
    ROUTED: ["ROUTED", "QR_CREATED", "PAYING", "SUCCESS", "FAILED", "UNKNOWN", "CLOSED"],
    QR_CREATED: ["QR_CREATED", "PAYING", "SUCCESS", "FAILED", "UNKNOWN", "CLOSED"],
    PAYING: ["PAYING", "SUCCESS", "FAILED", "UNKNOWN", "CLOSED"],
    UNKNOWN: ["UNKNOWN", "SUCCESS", "FAILED", "CLOSED"],
    FAILED: ["FAILED", "SUCCESS"],
    CLOSED: ["CLOSED", "SUCCESS"],
    SUCCESS: ["SUCCESS"]
  };
  if (!allowed[current.status].includes(status)) throw new Error("ORDER_STATUS_TRANSITION_INVALID");
  db.prepare(`UPDATE orders SET status = ?, code_url = ?, qr_data_url = ?, transaction_id = ?, paid_at = ? WHERE id = ?`)
    .run(status, values.codeUrl ?? current.codeUrl, values.qrDataUrl ?? current.qrDataUrl,
      values.transactionId ?? current.transactionId, status === "SUCCESS" ? (current.paidAt ?? nowIso()) : current.paidAt, id);
  if (status === "SUCCESS") {
    const entry = getPublicPaymentEntryByOrder(id);
    if (entry && entry.status === "ACTIVE") updatePublicPaymentEntry(entry.id, { status: "PAID", usedAt: nowIso() });
  }
  if (status !== current.status) {
    if (status === "SUCCESS") { consumeRouteCapacity(id); recordMerchantOrderSuccess(String(current.merchantId), id, Number(current.amount)); if (current.clientMerchantId) recordClientMerchantOrderSuccess(String(current.clientMerchantId), id, Number(current.amount)); }
    else if (["FAILED", "CLOSED"].includes(status)) { releaseRouteCapacity(id); recordMerchantOrderFailure(id); }
    recordOrderEvent(id, "STATUS_CHANGE", current.status, status, { transactionId: values.transactionId ?? current.transactionId });
    const updated = getOrder(id);
    if (updated) enqueueMerchantWebhook(String(updated.merchantId), "ORDER_STATUS", `${updated.id}:${status}`, updated);
  }
}

export function bindPublicPaymentOpenid(orderId: string, openidHash: string): boolean {
  const changed = db.prepare(`UPDATE orders SET payment_openid_hash = ?
    WHERE id = ? AND payment_method = 'JSAPI' AND (payment_openid_hash IS NULL OR payment_openid_hash = ?)`)
    .run(openidHash, orderId, openidHash).changes;
  return changed > 0;
}

export function insertPaymentAttempt(orderId: string, channelId: string, status: string, errorCode?: string): void {
  db.prepare("INSERT INTO payment_attempts (id, order_id, channel_id, status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomId("attempt"), orderId, channelId, status, errorCode ?? null, nowIso());
}

export function insertWebhookEvent(channelId: string, notificationId: string | null, outTradeNo: string | null, eventType: string, payload: string): boolean {
  try {
    db.prepare("INSERT INTO webhook_events (id, channel_id, notification_id, out_trade_no, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomId("event"), channelId, notificationId, outTradeNo, eventType, payload, nowIso());
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) return false;
    throw error;
  }
}

export function recordCallbackTask(input: { channelId: string; notificationId: string | null; payload: string; error: string; callbackType?: "TRANSACTION" | "REFUND" }): void {
  const timestamp = nowIso();
  db.prepare(`INSERT INTO callback_tasks (id, channel_id, notification_id, payload, callback_type, status, attempts, next_retry_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)
    ON CONFLICT(channel_id, notification_id) DO UPDATE SET status = CASE WHEN callback_tasks.status = 'SUCCESS' THEN 'SUCCESS' ELSE 'PENDING' END,
      next_retry_at = excluded.next_retry_at, last_error = excluded.last_error, updated_at = excluded.updated_at`)
    .run(randomId("callback"), input.channelId, input.notificationId, input.payload, input.callbackType ?? "TRANSACTION", timestamp, input.error, timestamp, timestamp);
}

export function listCallbackTasks(limit = 100): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(`SELECT id, channel_id AS channelId, notification_id AS notificationId, callback_type AS callbackType, status, attempts,
    next_retry_at AS nextRetryAt, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt
    FROM callback_tasks ORDER BY updated_at DESC LIMIT ?`).all(safeLimit) as Array<Record<string, unknown>>;
}

export function listRetryableCallbackTasks(limit = 50): Array<Record<string, unknown>> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return db.prepare(`SELECT id, channel_id AS channelId, notification_id AS notificationId, payload, callback_type AS callbackType, status, attempts,
    next_retry_at AS nextRetryAt, last_error AS lastError FROM callback_tasks
    WHERE status IN ('PENDING', 'RETRYING') AND next_retry_at <= ? AND attempts < 8 ORDER BY next_retry_at LIMIT ?`).all(nowIso(), safeLimit) as Array<Record<string, unknown>>;
}

export function markCallbackTaskSuccess(id: string): void { db.prepare("UPDATE callback_tasks SET status = 'SUCCESS', updated_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), id); }
export function markCallbackTaskFailure(id: string, error: string, attempts: number): void {
  const status = attempts >= 8 ? "DEAD" : "RETRYING";
  const next = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** attempts * 1000)).toISOString();
  db.prepare("UPDATE callback_tasks SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?").run(status, attempts, next, error, nowIso(), id);
}
