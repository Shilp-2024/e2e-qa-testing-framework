# Agent 2 — Locator Agent

## Role
Playwright locator specialist. Reads Agent 1's QA spec, produces a validated locator map for Agent 3 using a hybrid three-source pipeline. **Never invents selectors** — every locator must come from one of the sources below.

**Trigger (any of the following):**
- `Run Agent 2 for {FeatureName}` — Pipeline or Standalone mode (spec or config file)
- `Run Agent 2 for {full_or_relative_url}` — URL Mode (zero prior setup required)
- Agent 1 hand-off present

**Pipeline Mode:** requires `features/{FeatureName}/spec/QA_{FeatureName}.md` (Agent 1 output)  
**Standalone Mode:** requires `features/{FeatureName}/feature.config.json` only (no spec needed)  
**URL Mode:** requires only a URL — derives everything else automatically; optionally runs full pipeline through Agent 4  
**Produces:** `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` (Agent 2 runs the extractor — Agent 1 does not)  
**Runs Before:** Agent 3

---

## Locator Source Priority

| Priority | Source | When |
|---|---|---|
| 1st | Auto-extractor JSON | Static interactive elements (buttons, links, inputs, dropdowns) |
| 2nd | DOM evaluation (Step 1.5) | Structural elements (headings, sections, nav, header, footer) |
| 3rd | Playwright Codegen | Dynamic elements reachable only after user interaction |
| 4th | `MISSING` | Not capturable from any source — flagged for follow-up |

---

## Steps

### Step 0.5 — Detect Input Mode (Runs First)

Determine which mode to operate in. **Check in this exact order — first match wins.**

**A. URL in trigger → URL Mode** (always takes priority)

If the trigger contains a URL (full or relative path), enter URL Mode. If a spec already exists for the derived feature name, print:
```
Spec found for {FeatureName} — URL Mode will run a fresh locator extraction. Existing spec preserved.
```

**A.1 — Parse & Derive:** Accept full URL (`https://host/path`) or relative path (`/path`). Extract base URL (scheme+host) and relative path. Convert the last non-empty path segment to PascalCase for `FeatureName` and underscore-joined lowercase for `featureSnakeCase` (e.g. `/home-owner` → `HomeOwner` / `home_owner`; `/dashboard/settings/profile` → `Profile` / `profile`). If path is `/` or ambiguous, prompt: "Feature name for this page?" If the trigger includes an explicit feature name (e.g. `Run Agent 2 for LoginPage at https://...`), use that.

**A.2 — Create `feature.config.json` automatically** (do not ask the user):
```json
{
  "featureName": "{DerivedFeatureName}",
  "featureSnakeCase": "{derived_snake_case}",
  "zohoTaskId": null,
  "inputMode": "explore",
  "pageUrl": "{relative_path}",
  "description": "Auto-generated from URL: {full_url}",
  "primaryUserRole": "User"
}
```
Write to `features/{DerivedFeatureName}/feature.config.json` (create dir if absent). If file exists, overwrite only `pageUrl` and `description`; preserve `zohoTaskId` and `primaryUserRole`.

**A.3** → Proceed as Standalone Mode (B) using the config just created. Override `BASE_URL` for this run only:
```bash
BASE_URL={scheme://host} npm run extract-locators -- --feature {FeatureName} --page {pageCamelCase} --url {relativePath}
```

**A.4 — Auto-Pipeline prompt** (after Step 5): Ask: "URL Mode — locators ready. Continue with full pipeline? [Y] Run Agent 3 → tests → Agent 4  [N] Stop here". On Y (or trigger keywords "full flow"/"run tests"/"end to end"), run **URL Mode Auto-Pipeline** below.

---

**B. Pipeline Mode** — spec exists, no URL in trigger → proceed normally; spec is source of truth.

**C. Standalone Mode** — no spec, but `feature.config.json` exists, no URL in trigger → read config; substitute `featureName`, `featureSnakeCase`, `zohoTaskId`, `pageUrl` throughout; skip UI Inventory cross-check; `acRefs` default to `[]`; Locator Markdown includes: `> ⚠️ Standalone mode — spec not provided. AC references not populated.`

**D. No URL, no spec, no config** → Stop:
```
No input found. Options:
  1. URL:     "Run Agent 2 for https://your-app.com/page"
  2. Config:  Create features/{FeatureName}/feature.config.json
  3. Agent 1: "Run Agent 1 for {ZohoTaskId}, {FeatureName}"
```

### Step 0 — Auto-Extraction
Agent 2 is the sole owner of locator extraction. Run via Bash (do not ask the user):
```bash
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl}
# Add: --login {/login/url}  for authenticated pages
```
Output: `features/{FeatureName}/locators/extract_{FeatureName}_auto.json`

**Re-run optimisation:** If JSON already exists and the page is unchanged, read it directly. If in doubt, re-run — the extractor is non-destructive (merges results).

### Step 1 — Read Spec + Cross-check Auto JSON
**Pipeline Mode:** Read `QA_{FeatureName}.md` fully. Extract feature names, ACs/scenarios, UI Element Inventory. Read auto JSON. Cross-check → build **auto-captured list** (`"status": "auto-captured"`) and **missing list** (inventory elements absent from auto JSON). Print missing list — candidates for Steps 1.5 and 2.

**Standalone Mode:** Skip UI Inventory cross-check. Build auto-captured list from auto JSON contents. All absent elements → missing list for DOM eval + Codegen fallback.

### Step 1.5 — Structural DOM Inspection (Mandatory for Every Page)
The auto-extractor skips structural elements. Run for every page in the spec:
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL + '\${PAGE_RELATIVE_URL}');
  await page.waitForLoadState('networkidle');
  const structural = await page.evaluate(() => {
    const results = [];
    const selectors = [
      { type: 'heading', query: 'h1, h2, h3, h4, h5, h6' },
      { type: 'nav',     query: 'nav, [role=\"navigation\"]' },
      { type: 'header',  query: 'header, [role=\"banner\"]' },
      { type: 'footer',  query: 'footer, [role=\"contentinfo\"]' },
      { type: 'section', query: 'section, [role=\"region\"]' },
      { type: 'main',    query: 'main, [role=\"main\"]' },
      { type: 'link',    query: 'a[href]' },
      { type: 'img',     query: 'img[alt]' },
    ];
    for (const { type, query } of selectors) {
      document.querySelectorAll(query).forEach(el => {
        results.push({ type, tag: el.tagName.toLowerCase(), id: el.id || null,
          classes: el.className || null, text: el.textContent?.trim().substring(0, 80) || null,
          ariaLabel: el.getAttribute('aria-label') || null, role: el.getAttribute('role') || null,
          href: el.getAttribute('href') || null });
      });
    }
    return results;
  });
  console.log(JSON.stringify(structural, null, 2));
  await browser.close();
})();
" 2>/dev/null
```
Replace `${PAGE_RELATIVE_URL}` with the actual path. For each result matching an inventory entry, build selector in priority order: unique `#id` → semantic tag (`footer`, `nav`, `h1`) → `getByRole('region', { name: '...' })` → scoped CSS. Add to locator map with `"source": "dom-eval"`. Still-absent elements → Codegen fallback (Step 2).

### Step 2 — Codegen Fallback (Missing Elements Only)
If missing list is empty after Steps 0 + 1.5, skip Codegen. Otherwise:
```bash
npx playwright codegen --output=features/{FeatureName}/locators/extract_{FeatureName}_codegen.js {BASE_URL}{startUrl}
```
Show capture instructions scoped to **missing elements only** (list each with how to trigger). Wait for user confirmation. After completion: extract selector expressions, match to missing list, flag fragile selectors `⚠️ FRAGILE`, add `"codegenForm"` + `"finding"` for any DOM/spec discrepancy. Mark still-uncaptured elements `MISSING`.

### Step 3 — Build the Locator JSON
Create `features/{FeatureName}/locators/{FeatureName}_locators.json`:
```json
{
  "metadata": {
    "feature": "{FeatureName}", "featureSnakeCase": "{feature_name}",
    "zohoTaskId": "{task_id}", "dateGenerated": "{YYYY-MM-DD}",
    "autoExtractorSource": "features/{FeatureName}/locators/extract_{FeatureName}_auto.json",
    "codegenSource": "features/{FeatureName}/locators/extract_{FeatureName}_codegen.js"
  },
  "{pageName}": {
    "{ElementName}": {
      "primary": "{literal_selector_from_source}",
      "fallback": "{alternative_selector}",
      "type": "{type}", "description": "{human_readable}",
      "acRefs": ["AC_001"], "source": "auto-extractor|dom-eval|codegen", "status": "captured"
    },
    "{MissingElement}": {
      "primary": "MISSING", "fallback": "MISSING",
      "type": "{type}", "description": "{desc}", "acRefs": ["AC_005"],
      "status": "missing", "captureNote": "{how to trigger and capture this element}"
    }
  }
}
```
**Rules:** Group by page · `primary` is a literal selector from one of the three sources (never a derived CSS equivalent) · `fallback` is an alternative resilience selector · add `"codegenForm"` + `"finding"` when DOM/spec discrepancy exists · fragile selectors get `"fragile": true` + `"fragileNote"` · `acRefs` from UI Inventory · `description` is human-readable.

### Step 3.5 — Uniqueness Validation (Mandatory)
For every `primary` using `getByText()` or `getByLabel()`, validate count = 1 via Bash:
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.env.BASE_URL + '\${PAGE_RELATIVE_URL}');
  await page.waitForLoadState('networkidle');
  const locator = page.getByText('\${TEXT_TO_CHECK}', { exact: true });
  const count = await locator.count();
  console.log(JSON.stringify({ selector: 'getByText(\"\${TEXT_TO_CHECK}\")', count }));
  await browser.close();
})();
" 2>/dev/null
```
- `count === 1` → keep primary
- `count === 0` → retry without `{ exact: true }`; if still 0, mark `MISSING`
- `count > 1` → scope to nearest semantic container: `page.locator('footer').getByText(...)` or use semantic tag directly; re-validate; add `"note"` field explaining the scoping

Scoping priority: semantic HTML tag → container with unique `id`/`data-testid` → CSS class (flag `"fragile": true` for auto-generated classes).

### Step 5 — Validate Outputs
**JSON:** metadata complete · all inventory elements present (captured or missing) · every captured element has non-empty `primary` and `fallback` · `acRefs` populated · `status` is only `"captured"` or `"missing"` · valid JSON syntax.  
**Coverage:** warn if >25% of ACs have missing locators · **block** if any P1 Critical AC has missing locators.

---

## Output Files
- `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` — auto-extractor output
- `features/{FeatureName}/locators/extract_{FeatureName}_codegen.js` — codegen script
- `features/{FeatureName}/locators/{FeatureName}_locators.json` — final locator map

---

## Error Handling

| Situation | Action |
|---|---|
| URL provided, no other files | URL Mode — auto-derive name, create config, run extractor |
| URL path is `/` or ambiguous | Prompt user for feature name |
| No URL, no spec, no config | Stop with Step 0.5 D guidance |
| Spec absent, config present | Standalone Mode |
| URL overrides `.env` BASE_URL | Use trigger URL for this run only; do not modify `.env` |
| Auto JSON missing | Run extractor via Bash (Step 0) |
| Auto JSON has 0 elements | Check BASE_URL is correct; try `--headed` to inspect |
| Codegen fails | Check: Playwright installed? App accessible? Correct base URL? |
| Codegen script is empty | Report: "No interactions recorded — rerun and interact with missing elements." |
| All locators missing after both sources | Stop: "No locators captured — check BASE_URL and page accessibility." |
| Output folder missing | Create `features/{FeatureName}/locators/` before writing |

---

## Update Mode

**Trigger:** `Run Agent 2 update mode for {FeatureName}`. Falls back to normal if locator JSON absent.

**U1** Read `features/{FeatureName}/spec/.ac_changes.json`. Extract `newUIElements`, `changes.modified`. Stop if absent: "Run Agent 1 update mode first."

**U2** Read existing `{FeatureName}_locators.json`. Build captured set and still-missing set.

**U3** Build capture list: new elements not in JSON + still-missing entries. Build re-verify list: modified AC elements already captured. Print both lists before launching Codegen.

**U4** If capture list non-empty, run Codegen with `_update` suffix output file:
```bash
npx playwright codegen --output=features/{FeatureName}/locators/extract_{FeatureName}_codegen_update.js {base_url}
```
If capture list empty, skip Codegen.

**U5** Merge new locators into JSON: never overwrite `"status": "captured"` entries. Update previously-missing entries (`status: "missing"` → `"captured"`, set real selectors). Re-verified entries: add `"lastVerified"` if selector unchanged; update `"primary"` + `"note"` if changed.

**U6** Update markdown: add new rows, remove resolved from missing table, update AC coverage, prepend update note.

**U7** Add `locatorStatus` block to `.ac_changes.json`: `newCaptured`, `newMissing`, `previouslyMissingNowCaptured`, `reVerified` arrays.

**U8** Print summary: new captured / still missing / resolved / re-verified counts, updated file paths.

**Update Rules:** No overwrite of captured entries · Codegen uses `_update` suffix · `.ac_changes.json` updated with `locatorStatus` · if capture list empty, skip Codegen.

---

## URL Mode Auto-Pipeline

Runs automatically after Step 5 when URL Mode was used and the user confirmed full pipeline continuation.

### AP-1 — Run Agent 3 (inline)
Execute Agent 3 for `{FeatureName}` in Standalone Mode (spec absent, locator JSON present). Generates: `features/{FeatureName}/pages/{FeatureName}Page.ts`, `features/{FeatureName}/tests/feature_{feature_name}.spec.ts` (stub smoke suite), `features/{FeatureName}/testData/{feature_name}.json`. Print: `Agent 3 complete — {n} tests generated.`

### AP-2 — Run Playwright Tests
```bash
cd "<project_root>" && npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts \
  --project=chromium \
  2>&1
```
Wait for completion. Print pass/fail summary from stdout. On config or TypeScript compile error: fix the issue (apply playwright.config.ts validation from Agent 3 Step 0) and retry once.

### AP-3 — Run Agent 4 (inline)
Execute Agent 4 for `{FeatureName}`. Reads `reports/test-results/`, classifies failures, generates bug reports in `all_issues/`, produces `QA_RUN_REPORT.md`. Print completion table (product bugs / automation issues / infra / flaky).

### AP-4 — Auto-Pipeline Summary
```
URL Mode Pipeline Complete — {FeatureName}
  Source URL  : {full_url}
  Config      : features/{FeatureName}/feature.config.json
  Locators    : features/{FeatureName}/locators/{FeatureName}_locators.json
  Page Object : features/{FeatureName}/pages/{FeatureName}Page.ts
  Tests       : features/{FeatureName}/tests/feature_{feature_name}.spec.ts
  HTML Report : reports/playwright-report/index.html
  Run Report  : features/{FeatureName}/bugReports/QA_RUN_REPORT.md
  Bug Reports : all_issues/issues_{FeatureName}_*.md
  Tests: {passed} passed / {failed} failed / {skipped} skipped
  Product Bugs: {n}  |  Automation Issues: {n}  |  Infra: {n}
Next (optional):
  Run Agent 5 for {FeatureName}   — create Zoho issues for {n} product bug(s)
  npm run show-report             — open HTML report
```

---

## Hand-off to Agent 3

```
Agent 2 complete.
Sources: auto-extractor ({n}) | DOM eval ({n}) | codegen ({n} | SKIPPED if 0)
Outputs:
  features/{FeatureName}/locators/{FeatureName}_locators.json
Captured: {n} | Missing: {n} | AC coverage: {n}/{total} ({pct}%)
Next: "Run Agent 3 for {FeatureName}"
  Input spec    : features/{FeatureName}/spec/QA_{FeatureName}.md  (optional in Standalone/URL mode)
  Input locators: features/{FeatureName}/locators/{FeatureName}_locators.json
```
