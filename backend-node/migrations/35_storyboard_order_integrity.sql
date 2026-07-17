WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY episode_id
      ORDER BY storyboard_number ASC, id ASC
    ) AS normalized_number
  FROM storyboards
  WHERE deleted_at IS NULL
)
UPDATE storyboards
SET storyboard_number = (
  SELECT normalized_number
  FROM ranked
  WHERE ranked.id = storyboards.id
)
WHERE deleted_at IS NULL
  AND storyboard_number <> (
    SELECT normalized_number
    FROM ranked
    WHERE ranked.id = storyboards.id
  );
