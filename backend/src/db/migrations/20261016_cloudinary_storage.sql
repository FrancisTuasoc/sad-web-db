-- Migration: Add Cloudinary storage support for GCash payment proofs and avatars

CREATE TABLE IF NOT EXISTS order_payment_proofs (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  mime_type VARCHAR(30) NOT NULL,
  image_data BYTEA,
  image_url VARCHAR(500),
  public_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE order_payment_proofs
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(255);

DO $$
BEGIN
  ALTER TABLE order_payment_proofs ALTER COLUMN image_data DROP NOT NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE users
  ALTER COLUMN avatar_url TYPE VARCHAR(500);
