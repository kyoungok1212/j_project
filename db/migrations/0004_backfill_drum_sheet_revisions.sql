INSERT INTO drum_sheet_revisions(
  sheet_id,
  user_id,
  revision_no,
  title,
  bpm,
  time_signature,
  steps_per_bar,
  total_bars,
  pattern_json,
  note_length_overrides_json,
  selected_samples_json,
  source_updated_at
)
SELECT
  s.id,
  s.user_id,
  1,
  s.title,
  s.bpm,
  s.time_signature,
  s.steps_per_bar,
  s.total_bars,
  s.pattern_json,
  s.note_length_overrides_json,
  s.selected_samples_json,
  s.updated_at
FROM drum_sheets s
WHERE NOT EXISTS (
  SELECT 1
  FROM drum_sheet_revisions r
  WHERE r.sheet_id = s.id
    AND r.user_id = s.user_id
);
