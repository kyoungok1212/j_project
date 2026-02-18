CREATE TABLE IF NOT EXISTS drum_sheets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  time_signature TEXT NOT NULL,
  steps_per_bar INTEGER NOT NULL,
  total_bars INTEGER NOT NULL,
  pattern_json TEXT NOT NULL,
  note_length_overrides_json TEXT NOT NULL,
  selected_samples_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_drum_sheets_user_updated_at
ON drum_sheets(user_id, updated_at DESC);

