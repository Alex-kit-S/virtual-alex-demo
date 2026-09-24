<!-- Table skeletons for the two generated registry surfaces. The generator fills {{...}} rows from
     system/manifest.json. Marker lines carry the edit-the-registry instruction so nobody hand-edits
     between them. This file is a template, not a document; it is never published as-is. -->

<!-- BLOCK:CLAUDE_REGION -->
<!-- ROUTING-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->
| # | Command | State | Trigger | One line | Spec + status |
|---|---------|-------|---------|----------|---------------|
{{ROUTING_ROWS}}
<!-- ROUTING-TABLE:END -->

<!-- BLOCK:PROJECT_TABLE -->
<!-- PROJECT-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->
| # | Project | State | One line |
|---|---------|-------|----------|
{{PROJECT_ROWS}}
<!-- PROJECT-TABLE:END -->
