# localminidrama-asset-bible

Purpose: create local continuity anchors for characters, scenes, and props.

Inputs:
- `drama_id`
- `story_events`

Outputs:
- characters with identity anchors
- character stage snapshots
- scenes and props

Rules:
- Use mock reference assets only in this non-provider phase.
- Store stages on `characters.stages`.
- Do not call external image or model providers.
