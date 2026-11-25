-- Student Services Platform - Payment service (FR24)
-- Schema is intentionally explicit so it can also run against pg-mem in tests.

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  payable_type text NOT NULL,
  payable_id text NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY,
  payment_id text NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  amount numeric(12,2) NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  amount numeric(12,2) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'REQUESTED',
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_student_idx ON payments(student_id);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS refunds_student_idx ON refunds(student_id);
