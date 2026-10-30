# Agent 5 — Jira Sync Agent

## Role
Reads Agent 4 bug reports, creates matching issues in Jira via the Jira Cloud REST API using credentials from `.env`, and detects duplicates.

> **Standalone Use:** Agent 5 has no dependency on Agents 1–3. It only needs `all_issues/issues_{FeatureName}_*.md` files, `jira/config.json`, and `.env` credentials. Bug report files can be authored manually following the template in Step 3 of Agent 4 — Jira issue creation does not require the full pipeline. If no matching `issues_*.md` files exist in `all_issues/`, Agent 5 exits cleanly with 0 processed.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Bug reports | `all_issues/issues_{FeatureName}_*.md` | Required (0 files = exits cleanly with 0 processed) |
| Credentials | `.env` (project root) | **Always required** |
| Config | `jira/config.json` | Optional — falls back to `.env` for project key |
| Sync log | `jira/sync_log.json` (created on first run) | Optional — created as `[]` if absent |

**Outputs:**
| Output | Path |
|---|---|
| Sync log | `jira/sync_log.json` (append-only) |

---

## Steps

### Step 1 — Load Configuration
Read `.env` for: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`.

Read `jira/config.json` for:
```json
{
  "projectKey": "<key>",
  "issueTypeName": "Bug",
  "aiIdentifiedLabel": "ai-identified",
  "defaultPriority": "Medium",
  "priorityMap": { "Critical": "Highest", "High": "High", "Medium": "Medium", "Low": "Low" }
}
```
`priorityMap` maps bug-report Severity → Jira priority *name* (Jira Cloud accepts priority by name, no numeric picklist IDs needed — unlike Zoho). If `jira/config.json` is absent, fall back to `.env`'s `JIRA_PROJECT_KEY` and the defaults above. Load `jira/sync_log.json` (create empty `[]` if absent).

**Build the auth header** — Jira Cloud uses a long-lived API token, not an OAuth refresh flow, so there is no token-exchange call:
```
Authorization: Basic {base64(JIRA_EMAIL:JIRA_API_TOKEN)}
Accept: application/json
Content-Type: application/json
```
Never use the MCP connector for this — it is unreliable in headless/unattended (`claude -p`) runs. Never log or persist the raw `JIRA_API_TOKEN` anywhere but memory for the duration of the run.

### Step 2 — Discover Bug Reports
Scan `all_issues/issues_{FeatureName}_*.md` for all issues belonging to this feature. Per file, parse:
- **`#` heading** (first line) → Jira issue summary
- **Metadata line** → `Bug ID`, `Feature`, `AC`, `Scenario`, `Severity`, `Reproducibility`
- **`## Description`** + **`## Steps to Reproduce`** + **`## Actual Results`** + **`## Expected Results`** → concatenated as the Jira issue description (exclude `## Proofs` — local evidence only)

### Step 3 — Duplicate Detection (Before Every Creation)
1. Check `jira/sync_log.json` — if `Bug ID` already has a `jiraIssueKey`, mark `duplicate_local`.
2. Call the Jira search API to fetch existing AI-created issues for this project (paginate with `startAt`/`maxResults`, `maxResults` max 100):
   ```
   GET {JIRA_BASE_URL}/rest/api/3/search?jql=project="{JIRA_PROJECT_KEY}" AND labels="{aiIdentifiedLabel}" ORDER BY created DESC&startAt=0&maxResults=100
   Authorization: Basic {base64(JIRA_EMAIL:JIRA_API_TOKEN)}
   ```
   Continue with `startAt=100, 200, …` until `startAt + issues.length >= total`. Always assert the response has an `issues` array (not an `errorMessages` object) before trusting a "no duplicates" result — an errored search must NOT be treated as "zero existing issues."
3. **Match semantically, not by exact title.** Team-reported issues describe the same defect in
   different words (e.g. "Status Filter Does Not Support Multi-Select" vs the generated
   "[AC_003 | SC-3.3] Status filter is single-select…"). Compare on the **feature area + the specific
   defect** (normalise case/punctuation; match on key phrases and the AC/scenario if present), not a
   string-equality check on the `#` heading. On a probable match, mark `duplicate_jira`, record the
   existing issue key, and skip creation. When uncertain, prefer flagging a candidate duplicate in the
   output over silently creating a second issue.
4. Only proceed to creation if neither check finds a duplicate.

### Step 4 — Create Jira Issues

**Create the issue (Jira Cloud REST API v3, JSON body):**
```
POST {JIRA_BASE_URL}/rest/api/3/issue
Authorization: Basic {base64(JIRA_EMAIL:JIRA_API_TOKEN)}
Content-Type: application/json
```

```json
{
  "fields": {
    "project": { "key": "{JIRA_PROJECT_KEY}" },
    "summary": "{full # heading from bug report, including [AC_XXX | SC-X.X] prefix}",
    "issuetype": { "name": "{issueTypeName from jira/config.json, default 'Bug'}" },
    "priority": { "name": "{mapped via priorityMap[Severity], default defaultPriority}" },
    "labels": ["{aiIdentifiedLabel}"],
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        { "type": "paragraph", "content": [ { "type": "text", "text": "{## Description text}" } ] },
        { "type": "paragraph", "content": [ { "type": "text", "text": "{## Steps to Reproduce text}" } ] },
        { "type": "paragraph", "content": [ { "type": "text", "text": "{## Actual Results text}" } ] },
        { "type": "paragraph", "content": [ { "type": "text", "text": "{## Expected Results text}" } ] }
      ]
    }
  }
}
```
> **Description must be Atlassian Document Format (ADF)**, not plain text or markdown — the v3 create API rejects a bare string. Split the concatenated bug-report body into one `paragraph` node per section (blank-line-separated) as shown above; do not attempt full markdown→ADF conversion (no tables/lists needed for this content).

The `labels` array on create is the **only step needed to tag the issue** — unlike Zoho, Jira Cloud's create API applies labels directly; there is no separate tagging call.

Capture the returned `id` and `key` from the response for the sync log.

Before creating, verify description contains no production credentials or real user PII — redact with `[REDACTED]` if found and log a warning.

On success, append to `jira/sync_log.json`:
```json
{
  "bugId": "BR_001",
  "featureName": "{FeatureName}",
  "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC1.2.md",
  "jiraIssueId": "10142",
  "jiraIssueKey": "WAP-231",
  "title": "[AC_007 | SC-1.2] ...",
  "createdAt": "2026-05-20T11:56:19Z",
  "status": "created"
}
```

### Step 5 — Handle Errors
| Situation | Action |
|---|---|
| Auth failure (401/403) | Re-check `JIRA_EMAIL`/`JIRA_API_TOKEN` are present and not swapped; retry the failed call once; abort if still failing |
| Rate limit (HTTP 429) | Respect `Retry-After` header if present, else wait 5s; retry once; if still failing, log `error` and continue with remaining reports |
| Non-2xx response | Log `errorMessages`/`errors` body; mark `error` in sync log; continue processing remaining reports |
| Malformed bug report | Skip file; add warning in sync report |
| Corrupted sync log | Reset to `[]`; log warning; proceed |
| Jira returns a validation error (e.g. unknown `issuetype`/`priority` name) | Log the field-level error from `errors`; fall back to project defaults where possible; else mark `error` |

### Step 6 — Update Sync Log
Append all new entries to `jira/sync_log.json`. **Never delete previous entries** — the log is append-only and is the source of truth for duplicate detection.

Final log structure (array, cumulative across all runs):
```json
[
  {
    "bugId": "BR_001", "featureName": "{FeatureName}",
    "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC1.2.md",
    "jiraIssueId": "10142", "jiraIssueKey": "WAP-231",
    "title": "[AC_007 | SC-1.2] ...", "createdAt": "2026-05-20T11:56:19Z", "status": "created"
  },
  {
    "bugId": "BR_002", "featureName": "{FeatureName}",
    "bugReportFile": "features/{FeatureName}/bugReports/issues_{FeatureName}_AC_XXX_SC2.4.md",
    "jiraIssueId": "10143", "jiraIssueKey": "WAP-232",
    "title": "[AC_007 | SC-2.4] ...", "createdAt": "2026-05-20T11:56:39Z", "status": "created"
  }
]
```

### Step 7 — Output Confirmation
```
## Jira Sync Complete

| Bug ID | Jira Issue | Title                        | Action      |
|--------|-----------|------------------------------|-------------|
| BR_001 | WAP-231   | [AC_007 | SC-1.2] ...         | ✅ Created  |
| BR_002 | —         | [AC_003 | SC-3.1] ...         | ⏭ Duplicate |

Sync Log : jira/sync_log.json
```

---

## Validation Rules

| Rule | Enforced |
|---|---|
| Every `issues_*.md` file is processed | Always |
| Duplicate check runs before every creation | Always |
| Sync log updated after every successful creation | Always |
| `.env` credentials never written to any output file | Always |
| API responses checked for non-2xx status | Always |
| Sync log is append-only (no entries deleted) | Always |
| `{aiIdentifiedLabel}` label added to every created issue directly on create (no separate tagging call needed, unlike Zoho) | Always |
| `issuetype`/`priority` sent by **name**, matching the project's configured scheme | Always |

## Error Handling

| Situation | Action |
|---|---|
| `.env` missing | Abort: "`.env` not found at project root — see `.env.example`" |
| `jira/config.json` missing | Use `.env` for `JIRA_PROJECT_KEY`; log warning |
| No `issues_*.md` files | Sync report with 0 processed; do not error |
| Network timeout | Retry after 10s; if still failing, mark `error` and continue |
| `sync_log.json` missing | Create `[]` and proceed |

## Security

1. **Never log credentials** — `JIRA_API_TOKEN` and the Basic auth header must not appear in any output file, sync report, or sync log.
2. **API token** — read fresh from `.env` for each run; never persist it or the encoded auth header to disk outside `.env` itself.
3. **PII / credentials in bug report descriptions** — redact with `[REDACTED]` before creating any Jira issue; log a warning.
4. **`.env` is gitignored** — warn user if `.env` is not in `.gitignore`.

## Jira REST API Endpoints Used

All calls use `Authorization: Basic {base64(JIRA_EMAIL:JIRA_API_TOKEN)}` built from `.env` credentials in Step 1. Never use the MCP connector — credentials in `.env` are sufficient and work in headless runs.

| Endpoint | Method | Purpose |
|---|---|---|
| `{JIRA_BASE_URL}/rest/api/3/search?jql=...` | GET | Fetch existing AI-created issues for duplicate detection — paginate `startAt=0,100,…`, `maxResults` max 100 |
| `{JIRA_BASE_URL}/rest/api/3/issue` | POST | Create a new bug issue (JSON body; `description` must be ADF, not plain text) |
| `{JIRA_BASE_URL}/rest/api/3/issue/{issueIdOrKey}` | GET | Re-fetch a created issue to confirm fields/labels applied |
| `{JIRA_BASE_URL}/rest/api/3/issue/{issueIdOrKey}` | PUT | Update fields on an existing issue, if ever needed |
| `{JIRA_BASE_URL}/rest/api/3/project/{JIRA_PROJECT_KEY}` | GET | Look up valid `issuetype`/`priority` names for the project, if a create call fails validation |

---

## File and Path Reference

| Item | Path |
|---|---|
| Bug reports to sync | `all_issues/issues_{FeatureName}_*.md` |
| Sync log (persistent) | `jira/sync_log.json` |
| Jira config | `jira/config.json` |
| Credentials | `.env` (project root — never committed)
