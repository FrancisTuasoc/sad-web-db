-- Website Reviews and Testimonials Table

CREATE TABLE IF NOT EXISTS website_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_avatar VARCHAR(500) DEFAULT '',
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_website_reviews_created_at ON website_reviews(created_at DESC);

