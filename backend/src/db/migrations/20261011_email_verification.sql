CREATE TABLE IF NOT EXISTS app.pending_verifications (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  user_data JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_verifications_token
  ON app.pending_verifications(token);
CREATE INDEX IF NOT EXISTS idx_pending_verifications_email
  ON app.pending_verifications(email);

ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE NOT NULL;

UPDATE app.users SET is_verified = TRUE;
