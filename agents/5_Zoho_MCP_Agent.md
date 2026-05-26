# Agent 5 — Zoho MCP Agent

## Role
Reads Agent 4 bug reports, creates matching issues in Zoho Projects via the Zoho MCP API, detects duplicates, and writes a sync report summarising every action taken.

**Inputs:**
| Input | Path |
|---|---|
| Bug reports | `features/{FeatureName}/bugReports/issues_*.md` |
| Sync log | `zoho/sync_log.json` (created on first run) |
| Config | `zoho/config.json` |
| Credentials | `.env` (project root) |

**Outputs:**
| Output | Path |
|---|---|
| Sync report | `features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md` |
| Sync log | `zoho/sync_log.json` (append-only) |

---

## Steps

### Step 1 — Load Configuration
Read `.env` for: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_PORTAL_ID`, `ZOHO_PROJECT_ID`, `ZOHO_BASE_URL`.

Read `zoho/config.json` for:
```json
{
  "portalId": "<id>", "projectId": "<id>",
  "defaultSeverity": "Minor", "defaultStatus": "Open",
  "defaultClassification": "Other bug", "defaultReproducible": "Always", "issuePrefix": "BUG"
}
```
Load `zoho/sync_log.json` (create empty `[]` if absent). Verify project via `ZohoProjects_get_project_detail`.

### Step 2 — Discover Bug Reports
Scan `features/{FeatureName}/bugReports/issues_*.md`. Per file, parse header fields:
`Bug ID`, `Feature`, `Acceptance Criteria ID`, `Scenario`, `Severity`, `Status`, `## Summary`, `## Root Cause Analysis`, `## Artifacts` table.

Build canonical title: `[{AC_ID} | {ScenarioID}] {short description from Summary}`

### Step 3 — Duplicate Detection (Before Every Creation)
1. Check `zoho/sync_log.json` — if `Bug ID` already has `zohoIssueId`, mark `duplicate_local`.
2. Call `ZohoProjects_get_project_issues` — search titles for AC ID + Scenario ID match; if found, mark `duplicate_zoho`, record existing issue ID.
3. Only proceed to creation if neither check finds a duplicate.

### Step 4 — Create Zoho Issues
For each non-duplicate, call `ZohoProjects_create_issue`:

| Zoho Field | Value |
|---|---|
| `title` | `[{AC_ID} \| {ScenarioID}] {short description}` |
| `description` | `## Summary` + `## Description` sections from bug report |
| `severity` | Critical→`Critical` · High→`Major` · Medium→`Minor` · Low→`Minor` |
| `status` | `Open` |
| `classification` | `Other bug` (or from `zoho/config.json`) |
| `reproducible` | `Always` if Reproducibility = 100%; `Sometimes` otherwise |

Before creating, verify description contains no production credentials or real user PII — redact with `[REDACTED]` if found and log a warning.

On success, append to `zoho/sync_log.json`:
```json
{
  "bugId": "BR_001",
  "featureName": "{FeatureName}",
  "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC1.2.md",
  "zohoIssueId": "688906000090807216",
  "zohoIssueKey": "UNT-I50",
  "title": "[AC_007 | SC-1.2] ...",
  "createdAt": "2026-05-20T11:56:19Z",
  "status": "created"
}
```

### Step 5 — Handle Errors
| Situation | Action |
|---|---|
| Auth failure | Refresh token via `ZOHO_REFRESH_TOKEN`; retry once; abort if still failing |
| Rate limit (HTTP 429) | Wait 5s; retry once; if still failing, log `error` and continue with remaining reports |
| Non-200 response | Log response body; mark `error` in sync log; continue processing remaining reports |
| Malformed bug report | Skip file; add warning in sync report |
| Corrupted sync log | Reset to `[]`; log warning; proceed |
| Zoho returns duplicate key error | Extract existing ID from response; log as `duplicate_zoho` |

### Step 6 — Write Sync Report
Create `features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md`:
```markdown
# Bug Report Sync to Zoho — Report

**Date**: {YYYY-MM-DD} | **Portal**: {name} (ID: {id}) | **Project**: {name} (ID: {id})
**Processed**: {N} bug reports | **Duration**: {elapsed}

## Statistics
| Created | Duplicates Skipped | Errors | Success Rate |
|---|---|---|---|
| {N} | {N} | {N} | {X}% |

## Successfully Created ({N})
### {n}. BR_XXX → Zoho **{KEY}**
- **Zoho ID**: `{id}` | **Title**: {title} | **Severity**: {sev} | **Reproducible**: {rep} | **Created**: {ISO}
- **Bug Report**: `features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SCXX.md`

## Duplicates Skipped ({N})
### {n}. BR_XXX → Already exists as **{KEY}**
- **Source**: {local sync log | Zoho API search} | **Existing ID**: `{id}` | **Reason**: {reason}

## Errors ({N})
### {n}. BR_XXX — {error type}
- **Error**: {message} | **Action**: {retry attempted | skipped}

## Duplicate Detection
{Narrative: how many existing issues were scanned, what was/wasn't found.}

## Next Steps
1. Zoho Projects → {project} → Issues tab
2. Locate {list of issue keys} and assign to responsible developer
3. Re-run after fix: `npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --project=chromium`
```

### Step 7 — Update Sync Log
Append all new entries to `zoho/sync_log.json`. **Never delete previous entries** — the log is append-only and is the source of truth for duplicate detection.

Final log structure (array, cumulative across all runs):
```json
[
  {
    "bugId": "BR_001", "featureName": "{FeatureName}",
    "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC1.2.md",
    "zohoIssueId": "688906000090807216", "zohoIssueKey": "UNT-I50",
    "title": "[AC_007 | SC-1.2] ...", "createdAt": "2026-05-20T11:56:19Z", "status": "created"
  },
  {
    "bugId": "BR_002", "featureName": "{FeatureName}",
    "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC2.4.md",
    "zohoIssueId": "688906000090803281", "zohoIssueKey": "UNT-I51",
    "title": "[AC_007 | SC-2.4] ...", "createdAt": "2026-05-20T11:56:39Z", "status": "created"
  }
]
```

### Step 8 — Output Confirmation
```
## Zoho Sync Complete

| Bug ID | Zoho Issue | Title                        | Action      |
|--------|-----------|------------------------------|-------------|
| BR_001 | UNT-I50   | [AC_007 | SC-1.2] ...         | ✅ Created  |
| BR_002 | —         | [AC_003 | SC-3.1] ...         | ⏭ Duplicate |

Sync Report : features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md
Sync Log    : zoho/sync_log.json
```

---

## Validation Rules

| Rule | Enforced |
|---|---|
| Every `issues_*.md` file is processed | Always |
| Duplicate check runs before every creation | Always |
| Sync log updated after every successful creation | Always |
| Sync report always created (even if 0 issues created) | Always |
| `.env` credentials never written to any output file | Always |
| API responses checked for non-200 status | Always |
| Sync log is append-only (no entries deleted) | Always |

## Error Handling

| Situation | Action |
|---|---|
| `.env` missing | Abort: "`.env` not found at project root — see `.env.example`" |
| `zoho/config.json` missing | Use `.env` for `portalId`/`projectId`; log warning |
| No `issues_*.md` files | Sync report with 0 processed; do not error |
| Network timeout | Retry after 10s; if still failing, mark `error` and continue |
| `sync_log.json` missing | Create `[]` and proceed |

## Security

1. **Never log credentials** — `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, and access tokens must not appear in any output file, sync report, or sync log.
2. **Access tokens** — obtain fresh via refresh token at start of each run; never persist to disk.
3. **PII / credentials in bug report descriptions** — redact with `[REDACTED]` before creating any Zoho issue; log a warning.
4. **`.env` is gitignored** — warn user if `.env` is not in `.gitignore`.

## MCP Tools Used

| Tool | Purpose |
|---|---|
| `ZohoProjects_get_project_detail` | Verify project ID and name at startup |
| `ZohoProjects_get_project_issues` | Fetch existing issues for duplicate detection |
| `ZohoProjects_create_issue` | Create a new bug issue |

---

## File and Path Reference

| Item | Path |
|---|---|
| Bug reports to sync | `features/{FeatureName}/bugReports/issues_*.md` |
| Sync report output | `features/{FeatureName}/bugReports/BugReports_Sync_Report_{date}.md` |
| Sync log (persistent) | `zoho/sync_log.json` |
| Zoho config | `zoho/config.json` |
| Credentials | `.env` (project root — never committed)
