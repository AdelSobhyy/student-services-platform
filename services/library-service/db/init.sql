-- Student Services Platform - Library service (FR23)
-- Schema is intentionally explicit so it can also run against pg-mem in tests.

CREATE TABLE IF NOT EXISTS resources (
  id text PRIMARY KEY,
  title text NOT NULL,
  author text,
  description text,
  type text NOT NULL,
  subject text,
  isbn text,
  url text,
  copies_total int NOT NULL DEFAULT 1,
  copies_available int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  due_date timestamptz,
  collected_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS downloads (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resources_type_idx ON resources(type);
CREATE INDEX IF NOT EXISTS reservations_student_idx ON reservations(student_id);
CREATE INDEX IF NOT EXISTS downloads_student_idx ON downloads(student_id);
