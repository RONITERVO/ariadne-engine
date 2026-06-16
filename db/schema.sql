-- Ariadne Engine PostgreSQL schema
-- Release-oriented baseline for immutable story commits, Git-like branches, BYOK provider metadata, and first-class audio.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS story_repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description TEXT,
  default_style TEXT,
  safety_profile TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  head_turn_id UUID,
  forked_from_turn_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(repo_id, name)
);

CREATE TABLE IF NOT EXISTS audio_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  storage_uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  codec TEXT NOT NULL,
  container TEXT NOT NULL,
  sample_rate INTEGER,
  duration_ms INTEGER,
  byte_length BIGINT,
  encryption_key_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sha256)
);

CREATE TABLE IF NOT EXISTS turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  parent_turn_id UUID REFERENCES turns(id),
  turn_index INTEGER NOT NULL CHECK (turn_index > 0),
  user_audio_asset_id UUID REFERENCES audio_assets(id),
  assistant_audio_asset_id UUID REFERENCES audio_assets(id),
  user_transcript TEXT NOT NULL DEFAULT '',
  assistant_transcript TEXT NOT NULL DEFAULT '',
  state_status TEXT NOT NULL DEFAULT 'pending' CHECK (state_status IN ('pending', 'canonized', 'needs_review', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  UNIQUE(branch_id, turn_index)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_head_turn_fk') THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_head_turn_fk FOREIGN KEY (head_turn_id) REFERENCES turns(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'branches_forked_from_turn_fk') THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_forked_from_turn_fk FOREIGN KEY (forked_from_turn_id) REFERENCES turns(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS transcript_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  start_ms INTEGER,
  end_ms INTEGER,
  text TEXT NOT NULL,
  confidence REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id UUID REFERENCES turns(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('actor', 'canonizer', 'auditor', 'summarizer', 'embedding', 'live-token', 'validation')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  context_hash TEXT,
  request_hash TEXT,
  request_json JSONB,
  response_json JSONB,
  usage_json JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  patch_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'rejected', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS branch_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL,
  state_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(branch_id, turn_id)
);

CREATE TABLE IF NOT EXISTS branch_current_states (
  branch_id UUID PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  head_turn_id UUID REFERENCES turns(id),
  state_json JSONB NOT NULL,
  state_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic_index_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  turn_id UUID REFERENCES turns(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('turn', 'event', 'entity', 'thread', 'summary')),
  text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Add vector column with pgvector if desired:
  -- embedding vector(1536)
);

CREATE TABLE IF NOT EXISTS continuity_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES story_repos(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  warning_type TEXT NOT NULL,
  message TEXT NOT NULL,
  repair_strategy TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_story_repos_owner ON story_repos(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches(repo_id);
CREATE INDEX IF NOT EXISTS idx_turns_branch_parent ON turns(branch_id, parent_turn_id);
CREATE INDEX IF NOT EXISTS idx_turns_branch_index ON turns(branch_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turns_parent ON turns(parent_turn_id);
CREATE INDEX IF NOT EXISTS idx_event_patches_turn ON event_patches(turn_id);
CREATE INDEX IF NOT EXISTS idx_event_patches_branch ON event_patches(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_branch_turn ON branch_snapshots(branch_id, turn_id);
CREATE INDEX IF NOT EXISTS idx_semantic_repo_branch ON semantic_index_entries(repo_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_continuity_warnings_open ON continuity_warnings(branch_id, resolved_at) WHERE resolved_at IS NULL;
