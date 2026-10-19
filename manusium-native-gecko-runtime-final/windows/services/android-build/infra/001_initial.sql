-- Production migration template. The local development service intentionally uses its durable JSON store.
-- Apply this migration only through the selected production migration runner.
CREATE TABLE IF NOT EXISTS build_plans (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  release TEXT NOT NULL,
  architecture TEXT NOT NULL,
  target TEXT NOT NULL,
  variant TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS build_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  build_plan_id TEXT NOT NULL REFERENCES build_plans(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  release TEXT NOT NULL,
  architecture TEXT NOT NULL,
  target TEXT NOT NULL,
  variant TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  progress INTEGER,
  error_code TEXT,
  safe_error_message TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS build_jobs_owner_status_idx ON build_jobs(owner_id, status);
CREATE TABLE IF NOT EXISTS build_workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  platform TEXT NOT NULL,
  architecture TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  current_job_id TEXT,
  registered_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS build_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES build_jobs(id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  progress INTEGER,
  public_metadata JSONB,
  UNIQUE(job_id, sequence)
);
CREATE TABLE IF NOT EXISTS build_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES build_jobs(id),
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS build_artifacts_job_idx ON build_artifacts(job_id, validation_status);
