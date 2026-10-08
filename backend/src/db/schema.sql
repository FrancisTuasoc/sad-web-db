-- PostgreSQL Database Schema for Burger Shop System

CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;

-- 1. Enum Types
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('customer', 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE user_status AS ENUM ('active', 'suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_fulfillment') THEN
    CREATE TYPE order_fulfillment AS ENUM ('pickup', 'delivery');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
    CREATE TYPE payment_method AS ENUM ('gcash', 'pay_at_shop', 'cod');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('unpaid', 'paid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'pending', 'preparing', 'ready_for_pickup', 'ready_to_deliver', 
      'completed', 'cancelled', 'to_pickup', 'to_ship'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'addon_qty_mode') THEN
    CREATE TYPE addon_qty_mode AS ENUM ('per_item', 'per_order');
  END IF;
END $$;

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'customer' NOT NULL,
  status user_status DEFAULT 'active' NOT NULL,
  avatar_url VARCHAR(255) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  contact_email VARCHAR(255) DEFAULT '',
  first_name VARCHAR(100) DEFAULT '',
  last_name VARCHAR(100) DEFAULT '',
  full_name VARCHAR(200) DEFAULT '',
  street VARCHAR(255) DEFAULT '',
  barangay VARCHAR(255) DEFAULT '',
  city VARCHAR(255) DEFAULT '',
  province VARCHAR(255) DEFAULT '',
  postal_code VARCHAR(4) DEFAULT '',
  address TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  sort_order INT DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Products Table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(200) UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock INT DEFAULT 0 NOT NULL CHECK (stock >= 0),
  low_stock_threshold INT DEFAULT 10 NOT NULL,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  image VARCHAR(255) DEFAULT '',
  is_addon BOOLEAN DEFAULT FALSE NOT NULL,
  is_available BOOLEAN DEFAULT TRUE NOT NULL,
  is_featured BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 6. Cart Items & Addons
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  addon_quantity_mode addon_qty_mode DEFAULT 'per_item' NOT NULL,
  quantity INT DEFAULT 1 NOT NULL CHECK (quantity >= 1),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_item_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_item_id UUID NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INT DEFAULT 1 NOT NULL CHECK (qty >= 1)
);

-- 7. Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee NUMERIC(10, 2) DEFAULT 0 NOT NULL CHECK (delivery_fee >= 0),
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  fulfillment order_fulfillment NOT NULL,
  payment_method payment_method NOT NULL,
  payment_status payment_status DEFAULT 'unpaid' NOT NULL,
  arrival_deadline TIMESTAMPTZ,
  gcash_reference VARCHAR(100) DEFAULT '',
  contact_full_name VARCHAR(200) NOT NULL,
  contact_first_name VARCHAR(100) DEFAULT '',
  contact_last_name VARCHAR(100) DEFAULT '',
  contact_email VARCHAR(255) DEFAULT '',
  contact_phone VARCHAR(50) NOT NULL,
  contact_street VARCHAR(255) DEFAULT '',
  contact_barangay VARCHAR(255) DEFAULT '',
  contact_city VARCHAR(255) DEFAULT '',
  contact_province VARCHAR(255) DEFAULT '',
  contact_postal_code VARCHAR(4) DEFAULT '',
  contact_address TEXT DEFAULT '',
  status order_status DEFAULT 'pending' NOT NULL,
  cancelled_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 8. Order Items & Addons
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  quantity INT NOT NULL CHECK (quantity >= 1),
  addon_quantity_mode addon_qty_mode DEFAULT 'per_item' NOT NULL,
  line_total NUMERIC(10, 2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS order_item_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  name VARCHAR(200) NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  qty INT DEFAULT 1 NOT NULL CHECK (qty >= 1)
);

-- 9. Order Status History Table
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status order_status NOT NULL,
  at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 10. Store Settings Table
CREATE TABLE IF NOT EXISTS store_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name VARCHAR(200) DEFAULT 'Burger Shop' NOT NULL,
  tagline VARCHAR(255) DEFAULT 'Flavor on Wheels - Freshly Grilled Everyday',
  address TEXT DEFAULT '123 Main Street, City Center',
  phone VARCHAR(50) DEFAULT '+63 912 345 6789',
  email VARCHAR(255) DEFAULT 'hello@burgershop.com',
  delivery_fee NUMERIC(10, 2) DEFAULT 30 NOT NULL CHECK (delivery_fee >= 0),
  delivery_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  pickup_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  gcash_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  cod_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  pay_at_shop_enabled BOOLEAN DEFAULT TRUE NOT NULL,
  gcash_name VARCHAR(100) DEFAULT 'Burger Shop HQ',
  gcash_number VARCHAR(50) DEFAULT '09171234567',
  accepting_orders BOOLEAN DEFAULT TRUE NOT NULL,
  minimum_order NUMERIC(10, 2) DEFAULT 0 NOT NULL CHECK (minimum_order >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settings_id UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  day_of_week VARCHAR(10) NOT NULL,
  open_time VARCHAR(5) DEFAULT '09:00' NOT NULL,
  close_time VARCHAR(5) DEFAULT '21:00' NOT NULL,
  closed BOOLEAN DEFAULT FALSE NOT NULL,
  UNIQUE(settings_id, day_of_week)
);

-- 11. Customer Avatars & Locks (Replaces GridFS)
CREATE TABLE IF NOT EXISTS customer_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  length INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_avatar_locks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lock_until TIMESTAMPTZ NOT NULL,
  lock_token UUID NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_customer_avatars_user_id ON customer_avatars(user_id);
