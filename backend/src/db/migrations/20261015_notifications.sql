-- Notifications Table for Customers and Admins
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  for_admin BOOLEAN DEFAULT FALSE NOT NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50),
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_for_admin ON notifications(for_admin);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
