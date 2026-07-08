# localminidrama-script-adapter

Purpose: turn Story IR and adaptation plans into editable episodes without silently destroying user-written episodes.

Inputs:
- `source_id`
- `adaptation_plan_id`
- `overwrite_existing_episodes`

Outputs:
- episode drafts
- applied plan metadata

Rules:
- Append by default when episodes already exist.
- Overwrite only when explicitly requested.
- Mark stale storyboards when an overwrite changes existing episode scripts.
