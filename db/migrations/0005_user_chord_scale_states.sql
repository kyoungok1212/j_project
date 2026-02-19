CREATE TABLE IF NOT EXISTS user_chord_states (
  user_id TEXT PRIMARY KEY,
  voicings_json TEXT NOT NULL,
  mutes_json TEXT NOT NULL,
  barres_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_user_chord_states_updated_at
ON user_chord_states(updated_at DESC);

CREATE TABLE IF NOT EXISTS user_scale_states (
  user_id TEXT PRIMARY KEY,
  patterns_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_user_scale_states_updated_at
ON user_scale_states(updated_at DESC);
