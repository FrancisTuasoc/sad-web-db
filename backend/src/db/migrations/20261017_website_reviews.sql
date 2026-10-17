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

-- Seed realistic initial customer reviews if table is empty
INSERT INTO website_reviews (customer_name, customer_avatar, rating, comment, created_at)
SELECT * FROM (VALUES
  ('Francis Tuason', '', 5, 'Best burgers in town! The patties are thick, savory, and grilled to absolute perfection. The online ordering was super fast and smooth.', NOW() - INTERVAL '2 days'),
  ('Maria Santos', '', 5, 'Their Complete Burger is legendary! Loaded with bacon, egg, cheese, and melted goodness. Pickup was hot and ready right on time.', NOW() - INTERVAL '4 days'),
  ('David Lee', '', 5, 'Clean website, seamless checkout with GCash, and delicious footlong sandwiches. Highly recommended to anyone craving quality comfort food.', NOW() - INTERVAL '6 days')
) AS v(customer_name, customer_avatar, rating, comment, created_at)
WHERE NOT EXISTS (SELECT 1 FROM website_reviews LIMIT 1);
