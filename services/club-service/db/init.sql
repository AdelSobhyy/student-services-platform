-- Student Services Platform - Club service
-- Schema is intentionally explicit so it can also run against pg-mem in tests.

CREATE TABLE IF NOT EXISTS clubs (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  proposed_by text,
  leader_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clubs_status_idx ON clubs(status);
CREATE INDEX IF NOT EXISTS clubs_category_idx ON clubs(category);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS memberships_club_idx ON memberships(club_id);
CREATE INDEX IF NOT EXISTS events_club_idx ON events(club_id);
CREATE INDEX IF NOT EXISTS events_starts_idx ON events(starts_at);
