-- Novel2Anime domain integrity is installed only after migrate.js audits legacy rows.
-- These constraints never delete data. Soft-deleted parents remain valid because they
-- still exist physically; hard deletes are restricted while dependent rows remain.

CREATE UNIQUE INDEX IF NOT EXISTS ux_n2a_source_items_key
  ON source_items(source_id, item_type, COALESCE(item_no, -1));

CREATE UNIQUE INDEX IF NOT EXISTS ux_n2a_workflow_steps_run_key
  ON workflow_steps(run_id, step_key);

CREATE UNIQUE INDEX IF NOT EXISTS ux_n2a_timeline_tracks_episode_type
  ON timeline_tracks(episode_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS ux_n2a_story_event_edges_key
  ON story_event_edges(COALESCE(source_id, -1), from_event_id, to_event_id, relation_type);

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_sources_parent_insert
BEFORE INSERT ON story_sources
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_sources.drama_id') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_sources_parent_update
BEFORE UPDATE OF drama_id ON story_sources
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_sources.drama_id') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM adaptation_plans WHERE source_id = OLD.id AND drama_id <> NEW.drama_id
  ) OR EXISTS (
    SELECT 1
      FROM source_items si
      JOIN story_events se ON se.source_item_id = si.id
     WHERE si.source_id = OLD.id AND se.drama_id <> NEW.drama_id
  ) OR EXISTS (
    SELECT 1 FROM story_event_edges WHERE source_id = OLD.id AND drama_id <> NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_sources dependent drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_source_items_parent_insert
BEFORE INSERT ON source_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: source_items.source_id') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_source_items_parent_update
BEFORE UPDATE OF source_id ON source_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: source_items.source_id') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM story_events se
      JOIN story_sources ss ON ss.id = NEW.source_id
     WHERE se.source_item_id = OLD.id AND se.drama_id <> ss.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: source_items dependent drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_events_parent_insert
BEFORE INSERT ON story_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_events.drama_id') END;
  SELECT CASE WHEN NEW.source_item_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM source_items WHERE id = NEW.source_item_id)
    THEN RAISE(ABORT, 'domain_integrity: story_events.source_item_id') END;
  SELECT CASE WHEN NEW.source_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM source_items si
      JOIN story_sources ss ON ss.id = si.source_id
     WHERE si.id = NEW.source_item_id AND ss.drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_events source drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_events_parent_update
BEFORE UPDATE OF drama_id, source_item_id ON story_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_events.drama_id') END;
  SELECT CASE WHEN NEW.source_item_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM source_items WHERE id = NEW.source_item_id)
    THEN RAISE(ABORT, 'domain_integrity: story_events.source_item_id') END;
  SELECT CASE WHEN NEW.source_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM source_items si
      JOIN story_sources ss ON ss.id = si.source_id
     WHERE si.id = NEW.source_item_id AND ss.drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_events source drama') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM story_event_edges see
     WHERE (see.from_event_id = OLD.id OR see.to_event_id = OLD.id)
       AND see.drama_id <> NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_events dependent drama') END;
  SELECT CASE WHEN NEW.source_item_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM story_event_edges see
      JOIN source_items si ON si.id = NEW.source_item_id
     WHERE (see.from_event_id = OLD.id OR see.to_event_id = OLD.id)
       AND see.source_id IS NOT NULL
       AND see.source_id <> si.source_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_events dependent source') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_adaptation_plans_parent_insert
BEFORE INSERT ON adaptation_plans
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: adaptation_plans.drama_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: adaptation_plans.source_id') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM story_sources WHERE id = NEW.source_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: adaptation_plans source drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_adaptation_plans_parent_update
BEFORE UPDATE OF drama_id, source_id ON adaptation_plans
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: adaptation_plans.drama_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: adaptation_plans.source_id') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM story_sources WHERE id = NEW.source_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: adaptation_plans source drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_runs_parent_insert
BEFORE INSERT ON workflow_runs
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_runs.drama_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_runs.episode_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episodes WHERE id = NEW.episode_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: workflow_runs episode drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_runs_parent_update
BEFORE UPDATE OF drama_id, episode_id ON workflow_runs
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_runs.drama_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_runs.episode_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episodes WHERE id = NEW.episode_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: workflow_runs episode drama') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM qa_reports WHERE run_id = OLD.id AND drama_id <> NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: workflow_runs dependent drama') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM qa_reports
     WHERE run_id = OLD.id AND episode_id IS NOT NULL AND episode_id <> NEW.episode_id
  ) THEN RAISE(ABORT, 'domain_integrity: workflow_runs dependent episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_steps_parent_insert
BEFORE INSERT ON workflow_steps
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_steps.run_id') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_steps_parent_update
BEFORE UPDATE OF run_id ON workflow_steps
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: workflow_steps.run_id') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM provider_invocations
     WHERE workflow_step_id = OLD.id AND run_id IS NOT NULL AND run_id <> NEW.run_id
  ) OR EXISTS (
    SELECT 1 FROM skill_invocations
     WHERE workflow_step_id = OLD.id AND run_id IS NOT NULL AND run_id <> NEW.run_id
  ) THEN RAISE(ABORT, 'domain_integrity: workflow_steps dependent run') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_tracks_parent_insert
BEFORE INSERT ON timeline_tracks
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_tracks.episode_id') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_tracks_parent_update
BEFORE UPDATE OF episode_id ON timeline_tracks
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_tracks.episode_id') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM timeline_items ti
      JOIN storyboards sb ON sb.id = ti.storyboard_id
     WHERE ti.track_id = OLD.id AND sb.episode_id <> NEW.episode_id
  ) THEN RAISE(ABORT, 'domain_integrity: timeline_tracks dependent episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_items_parent_insert
BEFORE INSERT ON timeline_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM timeline_tracks WHERE id = NEW.track_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_items.track_id') END;
  SELECT CASE WHEN NEW.storyboard_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM storyboards WHERE id = NEW.storyboard_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_items.storyboard_id') END;
  SELECT CASE WHEN NEW.storyboard_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM timeline_tracks tt
      JOIN storyboards sb ON sb.episode_id = tt.episode_id
     WHERE tt.id = NEW.track_id AND sb.id = NEW.storyboard_id
  ) THEN RAISE(ABORT, 'domain_integrity: timeline_items storyboard episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_items_parent_update
BEFORE UPDATE OF track_id, storyboard_id ON timeline_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM timeline_tracks WHERE id = NEW.track_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_items.track_id') END;
  SELECT CASE WHEN NEW.storyboard_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM storyboards WHERE id = NEW.storyboard_id)
    THEN RAISE(ABORT, 'domain_integrity: timeline_items.storyboard_id') END;
  SELECT CASE WHEN NEW.storyboard_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM timeline_tracks tt
      JOIN storyboards sb ON sb.episode_id = tt.episode_id
     WHERE tt.id = NEW.track_id AND sb.id = NEW.storyboard_id
  ) THEN RAISE(ABORT, 'domain_integrity: timeline_items storyboard episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_qa_reports_parent_insert
BEFORE INSERT ON qa_reports
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.drama_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.episode_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.run_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episodes WHERE id = NEW.episode_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports episode drama') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_runs WHERE id = NEW.run_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports run drama') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.episode_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workflow_runs
     WHERE id = NEW.run_id AND episode_id IS NOT NULL AND episode_id <> NEW.episode_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports run episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_qa_reports_parent_update
BEFORE UPDATE OF drama_id, episode_id, run_id ON qa_reports
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.drama_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM episodes WHERE id = NEW.episode_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.episode_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: qa_reports.run_id') END;
  SELECT CASE WHEN NEW.episode_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM episodes WHERE id = NEW.episode_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports episode drama') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_runs WHERE id = NEW.run_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports run drama') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.episode_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM workflow_runs
     WHERE id = NEW.run_id AND episode_id IS NOT NULL AND episode_id <> NEW.episode_id
  ) THEN RAISE(ABORT, 'domain_integrity: qa_reports run episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_provider_invocations_parent_insert
BEFORE INSERT ON provider_invocations
BEGIN
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: provider_invocations.run_id') END;
  SELECT CASE WHEN NEW.workflow_step_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id)
    THEN RAISE(ABORT, 'domain_integrity: provider_invocations.workflow_step_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.workflow_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id AND run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'domain_integrity: provider_invocations step run') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_provider_invocations_parent_update
BEFORE UPDATE OF run_id, workflow_step_id ON provider_invocations
BEGIN
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: provider_invocations.run_id') END;
  SELECT CASE WHEN NEW.workflow_step_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id)
    THEN RAISE(ABORT, 'domain_integrity: provider_invocations.workflow_step_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.workflow_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id AND run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'domain_integrity: provider_invocations step run') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_skill_invocations_parent_insert
BEFORE INSERT ON skill_invocations
BEGIN
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: skill_invocations.run_id') END;
  SELECT CASE WHEN NEW.workflow_step_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id)
    THEN RAISE(ABORT, 'domain_integrity: skill_invocations.workflow_step_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.workflow_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id AND run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'domain_integrity: skill_invocations step run') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_skill_invocations_parent_update
BEFORE UPDATE OF run_id, workflow_step_id ON skill_invocations
BEGIN
  SELECT CASE WHEN NEW.run_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_runs WHERE id = NEW.run_id)
    THEN RAISE(ABORT, 'domain_integrity: skill_invocations.run_id') END;
  SELECT CASE WHEN NEW.workflow_step_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id)
    THEN RAISE(ABORT, 'domain_integrity: skill_invocations.workflow_step_id') END;
  SELECT CASE WHEN NEW.run_id IS NOT NULL AND NEW.workflow_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_steps WHERE id = NEW.workflow_step_id AND run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'domain_integrity: skill_invocations step run') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_event_edges_parent_insert
BEFORE INSERT ON story_event_edges
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.drama_id') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.source_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_events WHERE id = NEW.from_event_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.from_event_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_events WHERE id = NEW.to_event_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.to_event_id') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM story_sources WHERE id = NEW.source_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges source drama') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM story_events WHERE id = NEW.from_event_id AND drama_id = NEW.drama_id
  ) OR NOT EXISTS (
    SELECT 1 FROM story_events WHERE id = NEW.to_event_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges event drama') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM story_events se
      JOIN source_items si ON si.id = se.source_item_id
     WHERE se.id IN (NEW.from_event_id, NEW.to_event_id) AND si.source_id <> NEW.source_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges event source') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_event_edges_parent_update
BEFORE UPDATE OF drama_id, source_id, from_event_id, to_event_id ON story_event_edges
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM dramas WHERE id = NEW.drama_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.drama_id') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM story_sources WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.source_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_events WHERE id = NEW.from_event_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.from_event_id') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM story_events WHERE id = NEW.to_event_id)
    THEN RAISE(ABORT, 'domain_integrity: story_event_edges.to_event_id') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM story_sources WHERE id = NEW.source_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges source drama') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM story_events WHERE id = NEW.from_event_id AND drama_id = NEW.drama_id
  ) OR NOT EXISTS (
    SELECT 1 FROM story_events WHERE id = NEW.to_event_id AND drama_id = NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges event drama') END;
  SELECT CASE WHEN NEW.source_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM story_events se
      JOIN source_items si ON si.id = se.source_item_id
     WHERE se.id IN (NEW.from_event_id, NEW.to_event_id) AND si.source_id <> NEW.source_id
  ) THEN RAISE(ABORT, 'domain_integrity: story_event_edges event source') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_episodes_dependent_drama_update
BEFORE UPDATE OF drama_id ON episodes
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM workflow_runs WHERE episode_id = OLD.id AND drama_id <> NEW.drama_id
  ) OR EXISTS (
    SELECT 1 FROM qa_reports WHERE episode_id = OLD.id AND drama_id <> NEW.drama_id
  ) THEN RAISE(ABORT, 'domain_integrity: episodes dependent drama') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_storyboards_dependent_episode_update
BEFORE UPDATE OF episode_id ON storyboards
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM timeline_items ti
      JOIN timeline_tracks tt ON tt.id = ti.track_id
     WHERE ti.storyboard_id = OLD.id AND tt.episode_id <> NEW.episode_id
  ) THEN RAISE(ABORT, 'domain_integrity: storyboards dependent episode') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_dramas_restrict_delete
BEFORE DELETE ON dramas
WHEN EXISTS (SELECT 1 FROM episodes WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_sources WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_events WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM adaptation_plans WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM workflow_runs WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_event_edges WHERE drama_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: dramas has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_dramas_restrict_id_update
BEFORE UPDATE OF id ON dramas
WHEN NEW.id IS NOT OLD.id AND (
  EXISTS (SELECT 1 FROM episodes WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_sources WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_events WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM adaptation_plans WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM workflow_runs WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE drama_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_event_edges WHERE drama_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: dramas id has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_episodes_restrict_delete
BEFORE DELETE ON episodes
WHEN EXISTS (SELECT 1 FROM storyboards WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM workflow_runs WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM timeline_tracks WHERE episode_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: episodes has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_episodes_restrict_id_update
BEFORE UPDATE OF id ON episodes
WHEN NEW.id IS NOT OLD.id AND (
  EXISTS (SELECT 1 FROM storyboards WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM workflow_runs WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE episode_id = OLD.id)
  OR EXISTS (SELECT 1 FROM timeline_tracks WHERE episode_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: episodes id has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_storyboards_restrict_delete
BEFORE DELETE ON storyboards
WHEN EXISTS (SELECT 1 FROM timeline_items WHERE storyboard_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: storyboards has timeline items');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_storyboards_restrict_id_update
BEFORE UPDATE OF id ON storyboards
WHEN NEW.id IS NOT OLD.id
 AND EXISTS (SELECT 1 FROM timeline_items WHERE storyboard_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: storyboards id has timeline items');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_sources_restrict_delete
BEFORE DELETE ON story_sources
WHEN EXISTS (SELECT 1 FROM source_items WHERE source_id = OLD.id)
  OR EXISTS (SELECT 1 FROM adaptation_plans WHERE source_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_event_edges WHERE source_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: story_sources has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_sources_restrict_id_update
BEFORE UPDATE OF id ON story_sources
WHEN NEW.id IS NOT OLD.id AND (
  EXISTS (SELECT 1 FROM source_items WHERE source_id = OLD.id)
  OR EXISTS (SELECT 1 FROM adaptation_plans WHERE source_id = OLD.id)
  OR EXISTS (SELECT 1 FROM story_event_edges WHERE source_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: story_sources id has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_source_items_restrict_delete
BEFORE DELETE ON source_items
WHEN EXISTS (SELECT 1 FROM story_events WHERE source_item_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: source_items has events');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_source_items_restrict_id_update
BEFORE UPDATE OF id ON source_items
WHEN NEW.id IS NOT OLD.id
 AND EXISTS (SELECT 1 FROM story_events WHERE source_item_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: source_items id has events');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_events_restrict_delete
BEFORE DELETE ON story_events
WHEN EXISTS (
  SELECT 1 FROM story_event_edges
   WHERE from_event_id = OLD.id OR to_event_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: story_events has edges');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_story_events_restrict_id_update
BEFORE UPDATE OF id ON story_events
WHEN NEW.id IS NOT OLD.id AND EXISTS (
  SELECT 1 FROM story_event_edges
   WHERE from_event_id = OLD.id OR to_event_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: story_events id has edges');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_runs_restrict_delete
BEFORE DELETE ON workflow_runs
WHEN EXISTS (SELECT 1 FROM workflow_steps WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM provider_invocations WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM skill_invocations WHERE run_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: workflow_runs has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_runs_restrict_id_update
BEFORE UPDATE OF id ON workflow_runs
WHEN NEW.id IS NOT OLD.id AND (
  EXISTS (SELECT 1 FROM workflow_steps WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM qa_reports WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM provider_invocations WHERE run_id = OLD.id)
  OR EXISTS (SELECT 1 FROM skill_invocations WHERE run_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: workflow_runs id has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_steps_restrict_delete
BEFORE DELETE ON workflow_steps
WHEN EXISTS (SELECT 1 FROM provider_invocations WHERE workflow_step_id = OLD.id)
  OR EXISTS (SELECT 1 FROM skill_invocations WHERE workflow_step_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: workflow_steps has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_workflow_steps_restrict_id_update
BEFORE UPDATE OF id ON workflow_steps
WHEN NEW.id IS NOT OLD.id AND (
  EXISTS (SELECT 1 FROM provider_invocations WHERE workflow_step_id = OLD.id)
  OR EXISTS (SELECT 1 FROM skill_invocations WHERE workflow_step_id = OLD.id)
)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: workflow_steps id has dependents');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_tracks_restrict_delete
BEFORE DELETE ON timeline_tracks
WHEN EXISTS (SELECT 1 FROM timeline_items WHERE track_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: timeline_tracks has items');
END;

CREATE TRIGGER IF NOT EXISTS trg_n2a_timeline_tracks_restrict_id_update
BEFORE UPDATE OF id ON timeline_tracks
WHEN NEW.id IS NOT OLD.id
 AND EXISTS (SELECT 1 FROM timeline_items WHERE track_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'domain_integrity: timeline_tracks id has items');
END;
