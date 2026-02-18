CREATE TABLE IF NOT EXISTS chords (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  root TEXT NOT NULL,
  tones_json TEXT NOT NULL,
  fingering_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS scales (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  root TEXT NOT NULL,
  pattern_positions_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS metronome_presets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  time_signature TEXT NOT NULL,
  subdivision TEXT NOT NULL,
  accent_pattern_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  musical_key TEXT NOT NULL,
  time_signature TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  loop_start REAL NOT NULL,
  loop_end REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  bpm INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_chords_root_type ON chords(root, type);
CREATE INDEX IF NOT EXISTS idx_scales_root_mode ON scales(root, mode);
CREATE INDEX IF NOT EXISTS idx_presets_user_created_at ON metronome_presets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phrases_user_updated_at ON phrases(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created_at ON practice_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_category_created_at ON practice_sessions(category, created_at DESC);

