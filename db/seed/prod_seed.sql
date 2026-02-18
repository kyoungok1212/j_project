INSERT OR REPLACE INTO chords (id, name, type, root, tones_json, fingering_json) VALUES
('01JCHORDCMAJOR', 'C Major', 'major', 'C', '["C","E","G"]', '[null,3,2,0,1,0]'),
('01JCHORDAMINOR', 'A Minor', 'minor', 'A', '["A","C","E"]', '[null,0,0,2,2,0]');

INSERT OR REPLACE INTO scales (id, name, mode, root, pattern_positions_json) VALUES
('01JSCALEAMINP1', 'A Minor Pentatonic P1', 'minor_pentatonic', 'A', '[{"position":1,"notes":["A","C","D","E","G"],"fretPositions":[{"string":6,"frets":[5,8]},{"string":5,"frets":[5,7]}]}]'),
('01JSCALECMAJOR1', 'C Major P1', 'major', 'C', '[{"position":1,"notes":["C","D","E","F","G","A","B"],"fretPositions":[{"string":5,"frets":[3,5,7]},{"string":4,"frets":[2,3,5]}]}]');

