-- Organisation profile used by FRA rules, approval workflow and planning settings
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended'));
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS org_type text NOT NULL DEFAULT 'nbfi';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS capital_m numeric NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '';
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '';

-- Where each record came from
ALTER TABLE records ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE records ADD COLUMN IF NOT EXISTS source_ref text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS meter_id int;
ALTER TABLE records ADD COLUMN IF NOT EXISTS evidence_id int;
CREATE UNIQUE INDEX IF NOT EXISTS records_source_ref_uq ON records(org_id, source_ref) WHERE source_ref IS NOT NULL;

-- Recurring sources ("meters"): defined once, then filled month by month in the grid
CREATE TABLE IF NOT EXISTS meters (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  factor_key text NOT NULL REFERENCES factors(key),
  label text NOT NULL,
  unit text NOT NULL,
  method text NOT NULL DEFAULT 'invoice' CHECK (method IN ('metered','invoice','estimate','spend')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meters_uq ON meters(facility_id, factor_key, label);

-- Every channel (file, scan, Odoo, ERP push) lands here first
CREATE TABLE IF NOT EXISTS inbox_items (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('excel','ocr','odoo','erp','text')),
  source_ref text,
  label text NOT NULL DEFAULT '',
  draft jsonb NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  evidence_id int,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_org_idx ON inbox_items(org_id, status);

CREATE TABLE IF NOT EXISTS ingest_keys (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  label text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes int NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consult_requests (
  id serial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  topic text NOT NULL,
  preferred_date text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','scheduled','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Existing demo data: derive meters from the records already entered
INSERT INTO meters(org_id, facility_id, factor_key, label, unit, method)
SELECT DISTINCT ON (r.facility_id, r.factor_key) r.org_id, r.facility_id, r.factor_key, f.name, r.unit, r.method
FROM records r JOIN factors f ON f.key = r.factor_key
ORDER BY r.facility_id, r.factor_key, r.end_date DESC
ON CONFLICT DO NOTHING;
UPDATE records r SET meter_id = m.id FROM meters m WHERE r.meter_id IS NULL AND m.facility_id = r.facility_id AND m.factor_key = r.factor_key;
UPDATE orgs SET capital_m = 250 WHERE capital_m = 0 AND name = 'Nile Foods Group';
