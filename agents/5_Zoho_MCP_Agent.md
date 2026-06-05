# Agent 5 — Zoho Sync Agent

## Role
Reads Agent 4 bug reports, creates matching issues in Zoho Projects via the Zoho REST API using credentials from `.env`, and detects duplicates.

> **Standalone Use:** Agent 5 has no dependency on Agents 1–3. It only needs `all_issues/issues_{FeatureName}_*.md` files, `zoho/config.json`, and `.env` credentials. Bug report files can be authored manually following the template in Step 3 of Agent 4 — Zoho task creation does not require the full pipeline. If no matching `issues_*.md` files exist in `all_issues/`, Agent 5 exits cleanly with 0 processed.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Bug reports | `all_issues/issues_{FeatureName}_*.md` | Required (0 files = exits cleanly with 0 processed) |
| Credentials | `.env` (project root) | **Always required** |
| Config | `zoho/config.json` | Optional — falls back to `.env` for portal/project IDs |
| Sync log | `zoho/sync_log.json` (created on first run) | Optional — created as `[]` if absent |

**Outputs:**
| Output | Path |
|---|---|
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
Load `zoho/sync_log.json` (create empty `[]` if absent).

**Get access token** — call Zoho OAuth using `.env` credentials (never use MCP connector):
```
POST https://accounts.zoho.com/oauth/v2/token
  grant_type=refresh_token
  refresh_token={ZOHO_REFRESH_TOKEN}
  client_id={ZOHO_CLIENT_ID}
  client_secret={ZOHO_CLIENT_SECRET}
```
Store the returned `access_token` in memory for all subsequent API calls. Never persist it to disk.

### Step 2 — Discover Bug Reports
Scan `all_issues/issues_{FeatureName}_*.md` for all issues belonging to this feature. Per file, parse:
- **`#` heading** (first line) → Zoho issue title
- **Metadata line** → `Bug ID`, `Feature`, `AC`, `Scenario`, `Severity`, `Reproducibility`
- **`## Description`** + **`## Steps to Reproduce`** + **`## Actual Results`** + **`## Expected Results`** → concatenated as Zoho issue description (exclude `## Proofs` — local evidence only)

### Step 3 — Duplicate Detection (Before Every Creation)
1. Check `zoho/sync_log.json` — if `Bug ID` already has `zohoIssueId`, mark `duplicate_local`.
2. Call Zoho REST API to search for existing issues:
   ```
   GET {ZOHO_BASE_URL}/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/bugs/
   Authorization: Zoho-oauthtoken {access_token}
   ```
   Search returned titles for an exact or near-exact match with the bug report `#` heading; if found, mark `duplicate_zoho`, record existing issue ID.
3. Only proceed to creation if neither check finds a duplicate.

### Step 4 — Create Zoho Issues
For each non-duplicate, call the Zoho REST API:
```
POST {ZOHO_BASE_URL}/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/bugs/
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/x-www-form-urlencoded
```

| Zoho Field | Value |
|---|---|
| `title` | Full `#` heading from bug report — includes `[AC_XXX \| SC-X.X]` prefix and plain descriptive title |
| `description` | `## Description` + `## Steps to Reproduce` + `## Actual Results` + `## Expected Results` sections (Proofs excluded) |
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
| Auth failure | Re-run the Step 1 token refresh; retry the failed call once; abort if still failing |
| Rate limit (HTTP 429) | Wait 5s; retry once; if still failing, log `error` and continue with remaining reports |
| Non-200 response | Log response body; mark `error` in sync log; continue processing remaining reports |
| Malformed bug report | Skip file; add warning in sync report |
| Corrupted sync log | Reset to `[]`; log warning; proceed |
| Zoho returns duplicate key error | Extract existing ID from response; log as `duplicate_zoho` |

### Step 6 — Update Sync Log
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

### Step 7 — Output Confirmation
```
## Zoho Sync Complete

| Bug ID | Zoho Issue | Title                        | Action      |
|--------|-----------|------------------------------|-------------|
| BR_001 | UNT-I50   | [AC_007 | SC-1.2] ...         | ✅ Created  |
| BR_002 | —         | [AC_003 | SC-3.1] ...         | ⏭ Duplicate |

Sync Log : zoho/sync_log.json
```

---

## Validation Rules

| Rule | Enforced |
|---|---|
| Every `issues_*.md` file is processed | Always |
| Duplicate check runs before every creation | Always |
| Sync log updated after every successful creation | Always |
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

## Zoho REST API Endpoints Used

All calls use `Authorization: Zoho-oauthtoken {access_token}` obtained from `.env` credentials in Step 1. Never use the MCP connector — credentials in `.env` are sufficient.

| Endpoint | Method | Purpose |
|---|---|---|
| `accounts.zoho.com/oauth/v2/token` | POST | Get access token from refresh token |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/` | GET | Fetch existing issues for duplicate detection |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/` | POST | Create a new bug issue |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/{bugId}/` | POST | Update an existing bug issue |

---

## File and Path Reference

| Item | Path |
|---|---|
| Bug reports to sync | `all_issues/issues_{FeatureName}_*.md` |
| Sync log (persistent) | `zoho/sync_log.json` |
| Zoho config | `zoho/config.json` |
| Credentials | `.env` (project root — never committed)
