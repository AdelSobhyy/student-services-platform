-- Student Services Platform - Transport service (FR8-FR10)
-- Schema is intentionally explicit so it can also run against pg-mem in tests.
-- IDs are generated in application code; no database defaults are required.

CREATE TABLE IF NOT EXISTS routes (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  origin text,
  destination text,
  distance_km numeric,
  duration_minutes integer,
  fare numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY,
  route_id text NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_at text NOT NULL,
  arrival_at text,
  vehicle text,
  capacity integer NOT NULL DEFAULT 1,
  seats_available integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'SCHEDULED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  schedule_id text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  seat_number integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedules_route_idx ON schedules(route_id);
CREATE INDEX IF NOT EXISTS schedules_departure_idx ON schedules(departure_at);
CREATE INDEX IF NOT EXISTS bookings_schedule_idx ON bookings(schedule_id);
CREATE INDEX IF NOT EXISTS bookings_student_idx ON bookings(student_id);
