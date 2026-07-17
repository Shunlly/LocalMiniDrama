ALTER TABLE storyboards ADD COLUMN video_local_path TEXT;

UPDATE storyboards
SET video_local_path = (
  SELECT vg.local_path
  FROM video_generations AS vg
  WHERE vg.storyboard_id = storyboards.id
    AND vg.status = 'completed'
    AND vg.deleted_at IS NULL
  ORDER BY COALESCE(
    NULLIF(TRIM(vg.completed_at), ''),
    NULLIF(TRIM(vg.updated_at), ''),
    NULLIF(TRIM(vg.created_at), ''),
    ''
  ) DESC, vg.id DESC
  LIMIT 1
)
WHERE (video_local_path IS NULL OR TRIM(video_local_path) = '')
  AND EXISTS (
    SELECT 1
    FROM video_generations AS vg
    WHERE vg.id = (
      SELECT latest.id
      FROM video_generations AS latest
      WHERE latest.storyboard_id = storyboards.id
        AND latest.status = 'completed'
        AND latest.deleted_at IS NULL
      ORDER BY COALESCE(
        NULLIF(TRIM(latest.completed_at), ''),
        NULLIF(TRIM(latest.updated_at), ''),
        NULLIF(TRIM(latest.created_at), ''),
        ''
      ) DESC, latest.id DESC
      LIMIT 1
    )
      AND vg.local_path IS NOT NULL
      AND TRIM(vg.local_path) != ''
  );
