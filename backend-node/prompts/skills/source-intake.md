# localminidrama-source-intake

Purpose: normalize a novel, outline, script, storyboard, comic description, or transcript into traceable source items and Story IR.

Inputs:
- `source_type`: optional explicit type. Empty means rule-based classification.
- `text`: source text.
- `target_episode_count`: requested episode count.

Outputs:
- `story_source`
- `source_items`
- `story_events`
- `story_event_edges`
- `adaptation_plan`

Rules:
- Preserve raw text on disk and store a content hash.
- Keep every generated event traceable to a source item.
- Generate more than linear `next` edges when a local heuristic can infer cause, conflict, reveal, or hook relations.
