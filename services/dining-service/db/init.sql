-- Student Services Platform - Dining service
-- Schema is intentionally explicit so it can also run against pg-mem in tests.
-- Ingredients, nutrition and conflict names are stored as comma-separated text.

CREATE TABLE IF NOT EXISTS meals (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'MAIN',
  price numeric(10, 2) NOT NULL,
  meal_date text NOT NULL,
  ingredients text,
  nutrition text,
  allergens text,
  stock_status text NOT NULL DEFAULT 'AVAILABLE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dietary_preferences (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  restrictions text,
  allergies text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  meal_id text NOT NULL,
  meal_name text NOT NULL,
  amount numeric(10, 2) NOT NULL,
  status text NOT NULL DEFAULT 'CREATED',
  payment_id text,
  conflicts text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS meals_date_idx ON meals(meal_date);
CREATE INDEX IF NOT EXISTS meals_stock_idx ON meals(stock_status);
CREATE INDEX IF NOT EXISTS dietary_user_idx ON dietary_preferences(user_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_meal_idx ON orders(meal_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
