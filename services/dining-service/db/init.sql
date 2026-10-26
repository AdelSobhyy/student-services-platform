-- Minimal sample schema, not the complete project ERD implementation.
CREATE TABLE meals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO meals (name) VALUES ('Vegetable Rice');
