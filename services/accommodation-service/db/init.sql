-- Student Services Platform - Accommodation service (FR4-FR7)
-- Schema is intentionally explicit so it can also run against pg-mem in tests.
-- IDs are generated in application code; no database defaults are required.

CREATE TABLE IF NOT EXISTS buildings (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'SINGLE',
  description text,
  price numeric NOT NULL DEFAULT 0,
  capacity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'AVAILABLE',
  amenities text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  check_in text NOT NULL,
  check_out text NOT NULL,
  nights integer NOT NULL DEFAULT 1,
  total_price numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_building_idx ON rooms(building_id);
CREATE INDEX IF NOT EXISTS rooms_status_idx ON rooms(status);
CREATE INDEX IF NOT EXISTS bookings_room_idx ON bookings(room_id);
CREATE INDEX IF NOT EXISTS bookings_student_idx ON bookings(student_id);
CREATE INDEX IF NOT EXISTS reviews_room_idx ON reviews(room_id);
