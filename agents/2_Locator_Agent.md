# Agent 2 — Locator Agent

## Role
Playwright locator specialist. Reads Agent 1's QA spec, produces a validated locator map for Agent 3 using a hybrid three-source pipeline. **Never invents selectors** — every locator must come from one of the sources below.

**Trigger:** `Run Agent 2 for {FeatureName}` or Agent 1 hand-off present.
**Requires:** `features/{FeatureName}/spec/QA_{FeatureName}.md` (Agent 1 output)
**Expects:** `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` (written by Agent 1 Step 8 — re-runs extractor only if absent)
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

### Step 0 — Auto-Extraction Check
Check if `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` exists.
- **Exists** → read directly; proceed to Step 1.
- **Missing** → run via Bash (do not ask the user):
```bash
npm run extract-locators -- --feature {FeatureName} --page {pageName} --url {relativeUrl}
# Add: --login {/login/url}  for authenticated pages
```
Output: `features/{FeatureName}/locators/extract_{FeatureName}_auto.json`

### Step 1 — Read Spec + Cross-check Auto JSON
Read `QA_{FeatureName}.md` fully. Extract: feature names, all ACs/scenarios, UI Element Inventory. Read the auto JSON. Cross-check → build:
- **Auto-captured list** — entries with `"status": "auto-captured"`
- **Missing list** — inventory elements absent from auto JSON (dynamic / structural)

Print missing list. These are candidates for Steps 1.5 and 2.

If spec not found → stop: "Run Agent 1 first to generate `features/{FeatureName}/spec/QA_{FeatureName}.md`."

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
Replace `${PAGE_RELATIVE_URL}` with the actual path from the spec. For each result matching an inventory entry, build selector in priority order: unique `#id` → semantic tag (`footer`, `nav`, `h1`) → `getByRole('region', { name: '...' })` → scoped CSS. Add to locator map with `"source": "dom-eval"`. Still-absent elements → Codegen fallback (Step 2).

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
    "{ElementWithDiscrepancy}": {
      "primary": "{selector}", "fallback": "{alt}",
      "codegenForm": "{exact_codegen_expression}",
      "finding": "PRODUCT BUG — DOM renders '{actual}' but spec requires '{expected}' (AC_XXX)",
      "type": "{type}", "description": "{desc}", "acRefs": ["AC_007"], "status": "captured"
    },
    "{MissingElement}": {
      "primary": "MISSING", "fallback": "MISSING",
      "type": "{type}", "description": "{desc}", "acRefs": ["AC_005"],
      "status": "missing", "captureNote": "{how to trigger and capture this element}"
    }
  }
}
```
**Rules:** Group by page · `primary` is a literal selector from one of the three sources (never a derived CSS equivalent) · `fallback` is an alternative resilience selector · add `"codegenForm"` when DOM/spec discrepancy exists · fragile selectors get `"fragile": true` + `"fragileNote"` · `acRefs` from UI Inventory · `description` is human-readable.

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
- `count > 1` → scope to nearest semantic container: `page.locator('footer').getByText(...)` or use the semantic tag directly; re-validate; add `"note"` field explaining the scoping

Scoping priority: semantic HTML tag → container with unique `id`/`data-testid` → CSS class (flag `"fragile": true` for auto-generated classes).

### Step 4 — Build the Locator Markdown
Create `features/{FeatureName}/locators/{FeatureName}_locators.md` with: captured locators table (constant, selector, page, state, notes), missing locators table (constant, description, how to capture), AC coverage matrix, follow-up capture checklist (conditions to trigger each missing element).

### Step 5 — Validate Outputs
**JSON:** metadata complete · all inventory elements present (captured or missing) · every captured element has non-empty `primary` and `fallback` · `acRefs` populated · `status` is only `"captured"` or `"missing"` · valid JSON syntax.
**Markdown:** all sections present.
**Coverage:** warn if >25% of ACs have missing locators · **block** if any P1 Critical AC has missing locators.

---

## Output Files

| File | Path |
|---|---|
| Auto-extractor JSON | `features/{FeatureName}/locators/extract_{FeatureName}_auto.json` |
| Codegen script | `features/{FeatureName}/locators/extract_{FeatureName}_codegen.js` |
| Locator JSON | `features/{FeatureName}/locators/{FeatureName}_locators.json` |
| Locator Markdown | `features/{FeatureName}/locators/{FeatureName}_locators.md` |

---

## Error Handling

| Situation | Action |
|---|---|
| Spec not found | Stop: "Run Agent 1 first." |
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

## Hand-off to Agent 3

```
Agent 2 complete.
Sources: auto-extractor ({n}) | DOM eval ({n}) | codegen ({n} | SKIPPED if 0)
Outputs:
  features/{FeatureName}/locators/{FeatureName}_locators.json
  features/{FeatureName}/locators/{FeatureName}_locators.md
Captured: {n} | Missing: {n} | AC coverage: {n}/{total} ({pct}%)
Next: "Run Agent 3 for {FeatureName}"
  Input spec    : features/{FeatureName}/spec/QA_{FeatureName}.md
  Input locators: features/{FeatureName}/locators/{FeatureName}_locators.json
```
