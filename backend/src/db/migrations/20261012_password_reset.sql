CREATE TABLE IF NOT EXISTS app.password_reset_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON app.password_reset_tokens(expires_at);
