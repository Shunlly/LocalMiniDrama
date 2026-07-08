# localminidrama-continuity-qa

Purpose: audit source traceability, Story IR, episode scripts, assets, storyboards, media/timeline, workflow integrity, provider records, and skill records.

Inputs:
- `drama_id`
- optional `episode_id`
- optional `run_id`
- `mode`: draft or production

Outputs:
- `qa_report`
- structured issues
- remediation actions

Rules:
- Draft mode can accept mock provider artifacts when timeline planning is complete.
- Production mode must not treat timeline placeholders alone as final real media.
- Automated remediation should select the smallest local workflow subset that addresses the issue.
