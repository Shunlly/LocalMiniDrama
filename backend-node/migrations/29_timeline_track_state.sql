ALTER TABLE timeline_tracks ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE timeline_tracks ADD COLUMN metadata TEXT;
