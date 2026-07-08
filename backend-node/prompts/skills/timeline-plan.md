# localminidrama-timeline-plan

Purpose: build a deterministic timeline plan from storyboard drafts.

Inputs:
- episodes
- storyboards

Outputs:
- timeline tracks
- timeline items
- SRT and manifest export data

Rules:
- Required track types are video, subtitle, voice, dialogue, effect, bgm, and transition.
- Store mock paths as placeholders until real media providers are connected later.
- Timeline planning must be auditable without FFmpeg.
