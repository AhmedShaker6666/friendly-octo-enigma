
CREATE TABLE IF NOT EXISTS orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sector text NOT NULL DEFAULT 'Other',
  boundary text NOT NULL DEFAULT 'Operational control',
  base_year int NOT NULL DEFAULT 2025,
  gwp_set text NOT NULL DEFAULT 'AR6' CHECK (gwp_set IN ('AR5','AR6')),
  revenue_m numeric NOT NULL DEFAULT 0,
  employees int NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','employee','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  city text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'Site',
  staff int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS factors (
  key text PRIMARY KEY,
  name text NOT NULL,
  scope int NOT NULL CHECK (scope IN (1,2,3)),
  category text NOT NULL,
  units jsonb NOT NULL,
  base_unit text NOT NULL,
  co2 numeric, ch4 numeric, n2o numeric, gwp numeric, co2e numeric,
  loc numeric, resid numeric,
  year int NOT NULL,
  geo text NOT NULL,
  source text NOT NULL DEFAULT 'Illustrative placeholder. Replace with a verified source.'
);

CREATE TABLE IF NOT EXISTS records (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  start_date text NOT NULL CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date text NOT NULL CHECK (end_date ~ '^\d{4}-\d{2}-\d{2}$'),
  factor_key text NOT NULL REFERENCES factors(key),
  qty numeric NOT NULL CHECK (qty > 0),
  unit text NOT NULL,
  method text NOT NULL CHECK (method IN ('metered','invoice','estimate','spend')),
  evidence text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  factor_override numeric,
  loc_factor numeric,
  mkt_type text NOT NULL DEFAULT 'none' CHECK (mkt_type IN ('none','cert','supplier')),
  mkt_cov numeric NOT NULL DEFAULT 0,
  mkt_cert text NOT NULL DEFAULT '',
  mkt_factor numeric,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','returned')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS records_org_idx ON records(org_id, start_date);

CREATE TABLE IF NOT EXISTS record_events (
  id serial PRIMARY KEY,
  record_id int NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  actor text NOT NULL,
  action text NOT NULL,
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbam_dossiers (
  org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());

-- demo rows use ids below 1000; new rows start above them
ALTER SEQUENCE records_id_seq RESTART WITH 1000;
ALTER SEQUENCE record_events_id_seq RESTART WITH 1000;
