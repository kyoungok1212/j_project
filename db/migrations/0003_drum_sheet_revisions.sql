CREATE TABLE IF NOT EXISTS drum_sheet_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  bpm INTEGER NOT NULL,
  time_signature TEXT NOT NULL,
  steps_per_bar INTEGER NOT NULL,
  total_bars INTEGER NOT NULL,
  pattern_json TEXT NOT NULL,
  note_length_overrides_json TEXT NOT NULL,
  selected_samples_json TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, sheet_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_drum_sheet_revisions_sheet_revision
ON drum_sheet_revisions(user_id, sheet_id, revision_no DESC);

CREATE INDEX IF NOT EXISTS idx_drum_sheet_revisions_saved_at
ON drum_sheet_revisions(user_id, saved_at DESC);
