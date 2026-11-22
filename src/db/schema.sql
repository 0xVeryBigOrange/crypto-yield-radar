-- Keymint ledger. Applied on boot. Statements are idempotent.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  balance_usd NUMERIC(30, 12) NOT NULL DEFAULT 0,
  reserved_usd NUMERIC(30, 12) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_balance_nonnegative CHECK (balance_usd >= 0),
  CONSTRAINT users_reserved_nonnegative CHECK (reserved_usd >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  rpm_limit INTEGER NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  amount_usd NUMERIC(30, 12) NOT NULL,
  from_address TEXT NOT NULL,
  confirmations INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposits_chain_check CHECK (chain IN ('ethereum', 'bsc')),
  CONSTRAINT deposits_chain_tx_unique UNIQUE (chain, tx_hash)
);

CREATE INDEX IF NOT EXISTS deposits_user_created ON deposits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  amount_usd NUMERIC(30, 12) NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reservations_status_check CHECK (status IN ('held', 'settled', 'settled_short', 'released'))
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  reservation_id UUID,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  upstream_cost_usd NUMERIC(30, 12) NOT NULL,
  charged_usd NUMERIC(30, 12) NOT NULL,
  markup NUMERIC(12, 6) NOT NULL,
  status TEXT NOT NULL,
  settlement TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT usage_status_check CHECK (status IN ('settled', 'settled_short', 'released')),
  CONSTRAINT usage_settlement_check CHECK (settlement IN ('usage', 'estimated', 'none'))
);

CREATE INDEX IF NOT EXISTS usage_logs_user_created ON usage_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_prices (
  model_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt_per_token NUMERIC(30, 18) NOT NULL,
  completion_per_token NUMERIC(30, 18) NOT NULL,
  request_price NUMERIC(30, 18) NOT NULL DEFAULT 0,
  context_length INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  day DATE PRIMARY KEY,
  request_count INTEGER NOT NULL,
  prompt_tokens BIGINT NOT NULL,
  completion_tokens BIGINT NOT NULL,
  upstream_cost_usd NUMERIC(30, 12) NOT NULL,
  charged_usd NUMERIC(30, 12) NOT NULL,
  markup_revenue_usd NUMERIC(30, 12) NOT NULL,
  deposit_usd NUMERIC(30, 12) NOT NULL,
  model_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_usd NUMERIC(30, 12) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_buckets (
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (api_key_id, window_start)
);
