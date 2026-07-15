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
  "defaultStatus": "Open", "defaultClassification": "Other bug", "issuePrefix": "BUG",
  "aiIdentifiedTagId": "<tag id for 'AI identified'>",
  "severityIds": { "Critical": "<id>", "Major": "<id>", "Minor": "<id>" },
  "classificationIds": { "Other bug": "<id>", "Functional": "<id>" },
  "severityMap": { "Critical": "Critical", "High": "Major", "Medium": "Minor", "Low": "Minor" }
}
```
`severityIds` / `classificationIds` / `aiIdentifiedTagId` are portal-specific picklist IDs used in Step 4 — if absent for a new portal, fetch them from `bugs/defaultfields/` and the project tag list. Load `zoho/sync_log.json` (create empty `[]` if absent).

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
2. Call Zoho REST API to fetch existing issues (paginate — `range` max is 100):
   ```
   GET {ZOHO_BASE_URL}/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/bugs/?range=100&index=1
   (then index=101, 201, … until a page returns no bugs)
   Authorization: Zoho-oauthtoken {access_token}
   ```
   > ⚠️ **Do NOT pass `flag=all` (or `flag=allbugs`)** — Zoho rejects it with error 6832
   > ("Input Parameter Does not Match the Pattern Specified") and the whole response becomes an
   > error object, so `.get('bugs',[])` yields `[]` and duplicate detection silently passes. Omit
   > `flag` entirely. Always assert the response parsed to a real `bugs` array (not an `error`
   > object) before trusting a "no duplicates" result — an errored fetch must NOT be treated as
   > "zero existing issues."
3. **Match semantically, not by exact title.** Team-reported issues describe the same defect in
   different words (e.g. "Status Filter Does Not Support Multi-Select" vs the generated
   "[AC_003 | SC-3.3] Status filter is single-select…"). Compare on the **feature area + the specific
   defect** (normalise case/punctuation; match on key phrases and the AC/scenario if present), not a
   string-equality check on the `#` heading. On a probable match, mark `duplicate_zoho`, record the
   existing issue ID, and skip creation. When uncertain, prefer flagging a candidate duplicate in the
   output over silently creating a second issue.
4. Only proceed to creation if neither check finds a duplicate.

### Step 4 — Create Zoho Issues (two calls per issue: classic create → v3 tag)

> ⚠️ **API field-name gotchas (verified — do not use the plain names).** The classic bugs API's
> GET response nests values as `severity:{id,type}`, but on **create/update** the plain form params
> `severity` / `classification` / `labels` / `tags` are **silently ignored** (200 OK, value never
> applied). You MUST send `severity_id` / `classification_id` with numeric picklist IDs, and tags can
> only be set via the **v3 `/issues` API** (the classic API cannot set tags at all).

**Step 4a — Create the issue (classic REST API, form-encoded):**
```
POST {ZOHO_BASE_URL}/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/bugs/
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/x-www-form-urlencoded
```

| Zoho Field | Value |
|---|---|
| `title` | Full `#` heading from bug report — includes `[AC_XXX \| SC-X.X]` prefix and plain descriptive title |
| `description` | `## Description` + `## Steps to Reproduce` + `## Actual Results` + `## Expected Results` sections (Proofs excluded) |
| `severity_id` | Critical→`688906000000007003` · High→`688906000000007005` (Major) · Medium/Low→`688906000000007007` (Minor). **Verify IDs per project** via `GET {ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/defaultfields/`. |
| `status` | `Open` |
| `classification_id` | `Other bug` = `688906000000021039` (or map from `zoho/config.json`; get IDs from `defaultfields/`) |
| `reproducible` | Only if the project has a configured `reproducible_details` picklist in `defaultfields/`; otherwise omit (many projects leave it disabled → stays `None`, not an error) |

Capture the returned `id_string` and `key` for Step 4b and the sync log.

**Step 4b — Attach the `AI identified` tag (v3 API, JSON body) — MANDATORY on every issue:**
```
PATCH https://projectsapi.zoho.com/api/v3/portal/{ZOHO_PORTAL_ID}/projects/{ZOHO_PROJECT_ID}/issues/{id_string}
Authorization: Zoho-oauthtoken {access_token}
Content-Type: application/json

{ "tags": [ { "id": "{AI_IDENTIFIED_TAG_ID}" } ] }
```
- v3 calls issues `/issues` (NOT `/bugs` — the v3 `/bugs/{id}` path is GET-only and rejects PATCH with `INVALID_METHOD`).
- `AI identified` tag id on portal `36485097` = `688906000088982480`. If unknown for another portal, fetch the project's tag list and match by name.
- **Alternative single-call form (also verified):** the v3 **create** `POST …/issues` accepts `{"name": "<title>", "tags":[{"id":"…"}]}` and applies the tag at creation — but v3 create does **not** reliably set severity/classification, so the two-step classic-create → v3-tag flow above is the recommended default.
- After tagging, re-`GET` the bug and confirm `tags[].name` includes `AI identified` before logging success.

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
| `AI identified` tag added to every created issue **via the v3 `/issues` PATCH** (classic `labels`/`tags` params do NOT work) — and re-fetched to confirm before logging `created` | Always |
| Severity/classification sent as `severity_id`/`classification_id` (numeric picklist IDs), never the plain string fields | Always |

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
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/defaultfields/` | GET | Fetch picklist IDs for `severity_id` / `classification_id` |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/?range=100&index=1` | GET | Fetch existing issues for duplicate detection — paginate `index=1,101,…`. **No `flag` param** (`flag=all` errors 6832); `range` max is 100. v3 list needs extra required params — avoid. |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/` | POST | Create a new bug issue (form-encoded; use `severity_id`/`classification_id`, NOT `severity`/`classification`) |
| `{ZOHO_BASE_URL}/portal/{portalId}/projects/{projectId}/bugs/{bugId}/` | POST | Update severity/classification on an existing bug (form-encoded, `*_id` fields) |
| `projectsapi.zoho.com/api/v3/portal/{portalId}/projects/{projectId}/issues/{bugId}` | PATCH | Attach tags — JSON body `{"tags":[{"id":"…"}]}`. **Only way to set tags.** |
| `projectsapi.zoho.com/api/v3/portal/{portalId}/projects/{projectId}/bugs/{bugId}/` | DELETE | Trash a bug (classic DELETE also works: `…/bugs/{id}/`) |

---

## File and Path Reference

| Item | Path |
|---|---|
| Bug reports to sync | `all_issues/issues_{FeatureName}_*.md` |
| Sync log (persistent) | `zoho/sync_log.json` |
| Zoho config | `zoho/config.json` |
| Credentials | `.env` (project root — never committed)
