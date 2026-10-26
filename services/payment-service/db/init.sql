-- Minimal sample schema, not the complete project ERD implementation.
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO payments (name) VALUES ('Sandbox payment example');
