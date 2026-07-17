-- Keep AI configuration reads side-effect free and enforce one active default per service type.
UPDATE ai_service_configs AS target
   SET is_default = 0
 WHERE target.deleted_at IS NULL
   AND target.is_default = 1
   AND EXISTS (
     SELECT 1
       FROM ai_service_configs AS preferred
      WHERE preferred.deleted_at IS NULL
        AND preferred.is_default = 1
        AND preferred.service_type = target.service_type
        AND (
          COALESCE(preferred.priority, 0) > COALESCE(target.priority, 0)
          OR (
            COALESCE(preferred.priority, 0) = COALESCE(target.priority, 0)
            AND preferred.id < target.id
          )
        )
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_service_configs_single_default
  ON ai_service_configs(service_type)
  WHERE deleted_at IS NULL AND is_default = 1;
