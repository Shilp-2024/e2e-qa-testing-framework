# Agent 2 — Locator Agent

## Role
Playwright locator specialist. Reads Agent 1's QA spec and produces a validated locator map for
Agent 3. **The single-session extractor does the heavy lifting** (interactive + structural + dynamic
+ uniqueness validation in one browser launch). Agent 2's job is to *drive* the extractor, assign
`acRefs`, review findings, and only fall back to manual Codegen when an element cannot be reached
declaratively. **Never invent selectors** — every locator comes from the extractor or Codegen.

**Trigger (any of):**
- `Run Agent 2 for {FeatureName}` — Pipeline or Standalone mode
- `Run Agent 2 for {full_or_relative_url}` — URL Mode (zero prior setup)
- Agent 1 hand-off present

**Modes:**
- **Pipeline** — `features/{FeatureName}/spec/QA_{FeatureName}.md` exists → spec is source of truth.
- **Standalone** — only `features/{FeatureName}/feature.config.json` exists → no spec; `acRefs` default to `[]`.
- **URL** — only a URL → derive everything, optionally run the full pipeline through Agent 4.

**Produces:** `features/{FeatureName}/locators/{FeatureName}_locators.json` (final) + `extract_{FeatureName}_auto.json` (raw audit snapshot).
**Runs before:** Agent 3.

---

## What the extractor produces (so you don't redo it)

`npm run extract-locators` now runs a **single browser session per page** that already does what
used to be three manual passes:

| Old manual step | Now |
|---|---|
| Step 0 auto-extract (interactive elements) | ✅ done by the script |
| Step 1.5 structural DOM crawl (headings, nav, dialogs, alerts, images) | ✅ folded into the same session |
| Step 3.5 per-selector uniqueness validation | ✅ every entry gets `matchCount` in the same session |
| Step 2 manual Codegen for dynamic elements | ⬆️ replaced by **interactions.json** (declarative); Codegen is last-resort only |

Each entry carries `source` (`dom-scan`/`structural`/`interaction`), `status` (`captured`/`missing`),
`matchCount`, and (when relevant) `validationNote`. The script **merge-preserves** your assigned
`acRefs`/`finding`/`codegenForm` on re-run and caches by DOM hash (skips unchanged pages; `--force`
overrides).

---

## Steps

### Step 0.5 — Detect mode (first match wins)
1. **URL in trigger → URL Mode.** Derive `FeatureName` (PascalCase) + `featureSnakeCase` from the
   last path segment (`/home-owner` → `HomeOwner`/`home_owner`). If path is `/` or ambiguous, ask
   "Feature name for this page?". Create/patch `features/{FeatureName}/feature.config.json`
   (`inputMode: "explore"`, `pageUrl`, `description`). Run the extractor with the trigger's host as
   `BASE_URL` for this run only (don't edit `.env`). Then go to Step 3, then offer the Auto-Pipeline.
2. **Spec exists → Pipeline Mode.**
3. **Config exists, no spec → Standalone Mode** (skip UI-inventory cross-check; `acRefs = []`).
4. **Nothing →** stop with guidance (URL / config / Agent 1 options).

### Step 1 — Read spec, list pages & UI inventory (Pipeline)
Read `QA_{FeatureName}.md` fully. Extract feature names, ACs/scenarios, the UI Element Inventory,
and the **set of pages** (each with its relative URL). For each AC scenario, note its **type** —
this drives which interactions you author in Step 2.

### Step 2 — Author interactions.json (for dynamic elements)
Before extracting, derive `features/{FeatureName}/locators/interactions.json` **from the spec's own
scenarios** so dynamic elements (validation errors, modals, dropdown options) are captured without
manual Codegen. Generic mapping:

| Scenario type | interactions.json step(s) |
|---|---|
| Negative / Input-Validation | `submitInvalid` on the save/submit control, `captureAfter: true` → captures rendered error elements |
| Confirmation / Warning modal (delete, deactivate, discard) | `click` the action, `captureAfter: true` → captures the `dialog`/`alertdialog` + its buttons |
| Dropdown / multi-select | `click` to open the control (and for **dependent** dropdowns, `selectOption` the parent first), `captureAfter: true` → enumerates option values |

Schema (keyed by the camelCase page name; values are project-specific, schema is generic):
```json
{
  "createAgencyPage": {
    "steps": [
      { "action": "selectOption", "target": "page.locator('#state')", "value": "Alabama", "note": "select parent state" },
      { "action": "click",         "target": "page.getByRole('button', { name: 'Counties Served' })", "captureAfter": true, "note": "open counties dropdown" },
      { "action": "submitInvalid", "target": "page.getByRole('button', { name: 'Save' })", "captureAfter": true, "note": "trigger validation errors" }
    ]
  }
}
```
Actions: `click` · `fill` (`value`) · `selectOption` (`value`) · `waitFor` (`state`) · `press` (`value`) · `submitInvalid`. Add `captureAfter: true` on any step whose result should be scanned.

### Step 3 — Run the extractor (once per page)
Agent 2 owns this — run via Bash, never ask the user:
```bash
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl}
# add --login {/login/url} for authenticated pages; --force to bypass the DOM-hash cache
```
Repeat for each page in the spec (the script merges pages into one file). The script reads
`interactions.json` automatically.

### Step 4 — Review & assign (the only manual work)
Open `{FeatureName}_locators.json` and:
1. **Assign `acRefs`** to each element from the UI Element Inventory (Pipeline mode).
2. **Review `matchCount`:** `>1` → scope to a semantic container (`page.locator('nav').getBy…`) and
   re-run, or document why; `0` with no fallback hit → confirm it's genuinely absent.
3. **Review `status: "missing"`:** if the spec needs it and an interaction could reach it, add an
   interactions step (Step 2) and re-run. Only if no declarative path works, run the Codegen
   fallback (Step 5).
4. Add `finding` notes for any spec-vs-DOM discrepancy (the F-xxx pattern). Flag fragile selectors
   with `"fragile": true` + `"fragileNote"`.

### Step 5 — Codegen fallback (last resort only)
Only for elements no interaction step could reach:
```bash
npx playwright codegen --output=features/{FeatureName}/locators/extract_{FeatureName}_codegen.js {BASE_URL}{startUrl}
```
Extract the recorded selectors into the relevant entries as `codegenForm` (highest runtime
priority). Mark anything still uncapturable `status: "missing"` with a `captureNote`.

### Step 6 — Validate output
- Metadata complete; every captured element has a real `primary` and `fallback`; `acRefs` populated
  (Pipeline); `status` is only `captured` or `missing`; valid JSON.
- **Block** if any P1-Critical AC has missing locators; **warn** if >25% of ACs have missing locators.

---

## Output files
- `features/{FeatureName}/locators/{FeatureName}_locators.json` — final locator map (authoritative)
- `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` — raw single-session snapshot
- `features/{FeatureName}/locators/interactions.json` — declarative dynamic-element triggers
- `features/{FeatureName}/locators/.extract_cache.json` — DOM-hash cache (auto-managed)

---

## Error handling

| Situation | Action |
|---|---|
| URL path `/` or ambiguous | Ask for feature name |
| No URL, no spec, no config | Stop with guidance (URL / config / Agent 1) |
| Extractor reports 0 elements | Check BASE_URL; re-run with `--headed` to inspect |
| Element `missing` but spec needs it | Add an interactions step and re-run; Codegen only if unreachable |
| `matchCount > 1` | Scope to a semantic container; re-run |
| Cache hit but page actually changed | Re-run with `--force` |
| Codegen empty | "No interactions recorded — rerun and interact with the missing elements." |

---

## Update Mode
**Trigger:** `Run Agent 2 update mode for {FeatureName}`.
1. Read `features/{FeatureName}/spec/.ac_changes.json` (`newUIElements`, `changes.modified`). Stop if absent: "Run Agent 1 update mode first."
2. Add/adjust `interactions.json` steps for new dynamic elements.
3. Re-run the extractor (`--force` on changed pages). Its merge-preserve keeps existing `acRefs`/`finding`/`codegenForm`; previously-missing entries flip to `captured` when found.
4. Assign `acRefs` for new elements; add a `locatorStatus` block to `.ac_changes.json` (`newCaptured`, `newMissing`, `previouslyMissingNowCaptured`, `reVerified`).

---

## URL Mode Auto-Pipeline
After Step 6 in URL Mode, ask: "Continue full pipeline? [Y] Agent 3 → tests → Agent 4  [N] stop".
On Y (or "full flow"/"end to end"):
1. **Agent 3 (inline)** for `{FeatureName}` (Standalone). Generates page object, spec, test data.
2. **Run tests** — use the exact hand-off command below.
3. **Agent 4 (inline)** — reads `reports/test-results/`, classifies failures, writes `all_issues/` + `QA_RUN_REPORT.md`.
4. Print the pipeline summary.

---

## Hand-off to Agent 3

```
Agent 2 complete.
Sources: dom-scan ({n}) | structural ({n}) | interaction ({n}) | codegen ({n} | SKIPPED if 0)
Output: features/{FeatureName}/locators/{FeatureName}_locators.json
Captured: {n} | Missing: {n} | AC coverage: {n}/{total} ({pct}%)
Next: "Run Agent 3 for {FeatureName}"
  Input spec    : features/{FeatureName}/spec/QA_{FeatureName}.md  (optional in Standalone/URL mode)
  Input locators: features/{FeatureName}/locators/{FeatureName}_locators.json
```
