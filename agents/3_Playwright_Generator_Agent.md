# Agent 3 — Playwright Test Generator

## Role
Generates a complete, production-ready Playwright test suite (Page Objects, test spec, test data) from the feature spec and locator map.

**Inputs:**
| Input | Path |
|---|---|
| Feature spec | `features/{FeatureName}/spec/QA_{FeatureName}.md` |
| Locator map | `features/{FeatureName}/locators/{FeatureName}_locators.md` |
| Locator JSON | `features/{FeatureName}/locators/{FeatureName}_locators.json` |

**Outputs:**
| Output | Path |
|---|---|
| Page object(s) | `features/{FeatureName}/pages/{PageName}Page.ts` |
| Test suite | `features/{FeatureName}/tests/feature_{feature_name}.spec.ts` |
| Test data | `features/{FeatureName}/testData/{feature_name}.json` |

---

## Steps

### Step 0 — Verify `playwright.config.ts`
Before generating any code, read the config and verify:
1. `import * as dotenv from 'dotenv'; dotenv.config();` at the very top of the file
2. `baseURL: process.env.BASE_URL` in the `use` block — **no hardcoded fallback**
3. `dotenv` listed in `package.json` dependencies

Fix any missing item and report: `"Fixed playwright.config.ts — [what changed]."` A missing `.env` must fail loudly — never silently use a wrong URL.

### Step 1 — Parse Feature Spec
Extract: feature names (PascalCase + snake_case), all ACs + scenarios (IDs, type, priority, feasibility), pre-conditions, manual-only ACs, environment notes.

### Step 2 — Parse Locator Map
Extract: all captured locators + selector expressions, missing locators (placeholders), URL constants, which ACs are covered vs. missing.

### Step 3 — Generate Test Data (`{feature_name}.json`)
Group by: `validUsers`/`validData`, `invalidUsers`/`invalidData`, `edgeCaseUsers`/`edgeCases`. Each entry has `description` field and AC reference. No production credentials. Include URL constants needed by the test suite.

### Step 4 — Generate Page Object(s)

**Locator Priority Rule (CRITICAL — apply before writing any constructor line):**

| Priority | JSON field | When to use |
|---|---|---|
| 1st | `codegenForm` | If present and not `"MISSING"` — use this; it is Codegen-verified from the live DOM |
| 2nd | `primary` | Only if `codegenForm` absent or `"MISSING"` |
| 3rd | `fallback` | Only if both above absent or `"MISSING"` |

**Strict Mode Guard (CRITICAL — apply before every constructor assignment):**

| Condition | Action |
|---|---|
| `source: "dom-eval"` AND `primary` uses `getByText()` | Use `fallback` — add `// fallback used: primary getByText() would match multiple elements` |
| `primary` uses `getByText()` AND `fallback` is a semantic tag (`page.locator('footer')`, `'header'`, `'nav'`, `'main'`, `'h1'`, etc.) | Use `fallback` — semantic tag is unambiguous |
| `primary` uses `getByText()` AND `"note"` field contains "matched 2" or "ambiguous" | Use `fallback` — Agent 2 already flagged the ambiguity |
| `source: "codegen"` with `getByText()`, OR any `getByRole/getByLabel/getByTestId/getByPlaceholder` | Use `primary` — intrinsically scoped |

If `finding` contains `"BUG"` / `"MISMATCH"` / `"PRODUCT BUG"`, use `codegenForm` and add:
```typescript
// ⚠️ PRODUCT BUG (AC_XXX): DOM renders "{actual}" but spec requires "{expected}"
// Using Codegen-captured locator — will fail assertion intentionally until app is fixed
```

**Page object rules:**
1. All locator properties `private readonly`
2. Constructor assigns using priority + guard above — never invent or derive selectors
3. Missing locators → placeholder value + `// TODO(Agent2-rerun): replace with real selector`
4. All public methods `async`
5. `click`, `fill`, `toBeVisible`, `toHaveText`, `waitFor` include `{ timeout: 90000 }` where applicable
6. Navigation calls `page.waitForLoadState('domcontentloaded')`
7. Every public method has a one-line JSDoc comment
8. **`navigate()` MUST use a relative path constant — never `process.env.BASE_URL + path` or `baseURL + path`**
9. Fixtures destructure `{ page }` only; exception: isolated viewport tests use `{ browser, baseURL }`

**Method naming:** `navigate()` · `click*()` · `enter*()/fill*()` · `check*()/uncheck*()` · `verify*()` · `is*Visible()` · `get*Text()` · `waitFor*()`

**Page object template:**
```typescript
import { Page, Locator, expect } from '@playwright/test';

export class {PageName}Page {
  private readonly page: Page;
  private readonly someElement: Locator;
  static readonly PAGE_PATH = '/some/path';

  constructor(page: Page) {
    this.page = page;
    this.someElement = page.getByRole('button', { name: 'Example' });
  }

  /** Navigate and wait for DOM content loaded. */
  async navigate() {
    await this.page.goto({PageName}Page.PAGE_PATH);  // relative — Playwright prepends baseURL
    await this.page.waitForLoadState('domcontentloaded');
  }
}
```

### Step 5 — Generate Test Suite

**Test suite rules:**
1. Group tests by `test.describe()` per scenario category
2. `test.beforeEach()` for shared setup only when all tests in the group share the same starting state
3. Every `test()` includes Scenario ID + AC ref(s) in title, Arrange/Act/Assert comment separators, specific `expect()` assertions
4. Missing selector → keep available assertions; comment out unavailable with `// TODO(Agent2-rerun): Uncomment once selector is captured`
5. Manual-only ACs → automate what's possible + `// NOTE: full verification requires manual testing`
6. Mobile/responsive tests → `browser.newContext({ viewport: {...} })`; always close in `finally`
7. No execution-order dependencies; no `setTimeout`/`sleep` — use Playwright waits only
8. Every `test()` block must carry `{ tag: [...] }` — see Step 5.1
9. Import paths from `tests/` folder: `../pages/`, `../testData/`, `../../../shared/utils/`

### Step 5.1 — Test Tagging (Mandatory for Every Test)

```typescript
test('SC-2.1 | AC_002 — Valid credentials authenticate and redirect',
  { tag: ['@smoke', '@regression', '@functional'] },
  async ({ page }) => { ... }
);
```

| Tag | Purpose | Safe on production? |
|---|---|---|
| `@smoke` | Core happy path — proves app is alive | Yes |
| `@regression` | High-value set run on every build | Staging/CI |
| `@functional` | All automatable business-logic tests | Staging/CI |
| `@security` | Auth, masking, HTTPS, session, injection | Staging |

**Tag assignment — apply per scenario (a test carries multiple tags):**

| Condition | Tags to assign |
|---|---|
| Happy Path · P1 · no destructive/stateful side-effects | `@smoke @regression @functional` |
| P1 or P2 · not a known product bug · not redundant | `@regression @functional` |
| Automatable or Partially Automatable | `@functional` |
| Security scenario | `@functional @security` (add `@regression` if P1) |
| Known product bug (`finding: PRODUCT BUG` in locator JSON) | `@functional` **only** — omit `@smoke` and `@regression` |
| Manual Only | No tags — no `test()` block generated |

### Step 6 — Validate Outputs

**`playwright.config.ts`:** dotenv import present · `baseURL: process.env.BASE_URL` (no hardcoded fallback).

**Page objects:** locators `private readonly` · priority rule followed · `finding` elements use `codegenForm` + BUG comment · placeholders have `// TODO(Agent2-rerun)` · `navigate()` uses relative path constant · `waitForLoadState` present · no hardcoded waits.

**Test suite:** import paths from `tests/` folder · every title has Scenario ID + AC ref · Arrange-Act-Assert · `{ tag: [...] }` on every test · known-bug tests have only `@functional` · mobile viewport tests close context in `finally` · no `test.only()` without justification.

### Step 7 — Output Summary
Print: file table (path, line count, notes) + AC coverage table (AC, status, scenarios, notes). Then:
```
Next: npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --reporter=html,json,junit
Then run Agent 4.
```

---

## Framework Standards

| Standard | Value |
|---|---|
| Global timeout | 90 000 ms |
| Load state | `domcontentloaded` |
| Assertions | `expect()` from `@playwright/test` |
| Test isolation | No shared mutable state across tests |
| Waits | `waitFor`, `waitForURL`, `waitForLoadState` only — no `sleep` |

## Error Handling

| Situation | Action |
|---|---|
| Missing locators | Placeholder + `// TODO(Agent2-rerun)` + comment out dependent assertions |
| Manual-only AC | Skip automation + `// NOTE: manual verification required` comment |
| AC has no matching scenarios | Log in output summary; do not skip silently |
| Ambiguous selector | `.first()` + comment explaining why |
| Feature has multiple pages | One Page Object file per page |

---

## Update Mode

**Trigger:** `Run Agent 3 update mode for {FeatureName}`. Falls back to normal if test file absent.

**U1** Read `features/{FeatureName}/spec/.ac_changes.json`. Extract: `changes.new/modified/removed/unchanged`, `affectedTests.new/modify/skip`, `locatorStatus.newCaptured`. Stop if absent: "Run Agent 1 and Agent 2 update modes first."

**U2** Read existing test suite, test data, and page object(s). Map every `test()` block → AC refs + Scenario ID from the title string.

**U3 — New ACs:** Generate new `test.describe()` + `test()` blocks; append at **end of file**. Add scenario data to test data JSON (append only). Add page object methods (append only). Mark each new block:
```typescript
// ─────────────────────────────────────────────────────────────────────────
// Added {YYYY-MM-DD} — {task_id} | AC_{XXX}
// ─────────────────────────────────────────────────────────────────────────
```

**U4 — Modified ACs:** Minimum edit to existing test body. Add `// UPDATED {YYYY-MM-DD} — {task_id}: {reason}` above each changed line. Do not change test title, Scenario ID, or describe block structure unless the scenario category explicitly changed.

**U5 — Removed ACs:** Wrap with `test.skip()` — never delete:
```typescript
// SKIPPED {YYYY-MM-DD} — {task_id}: AC removed from scope
test.skip('SC-X.X | AC_XXX — {original title}', async ({ page }) => {
  // original body preserved unchanged
});
```

**U6** Validate only changed sections using same checklist as Step 6.

**U7** Print summary: new/updated/skipped/untouched test counts, data changes, page object changes.

**Update Rules:** Unchanged ACs untouched · removed tests skipped not deleted · new tests appended not inserted mid-file · `// UPDATED` on every changed line · `// Added` header on every new describe block · `// SKIPPED` on every skipped test · test data for unchanged scenarios not modified · existing page object methods not renamed or deleted.

---

## Hand-off to Agent 4

```
Next: npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --reporter=html,json,junit
Results → reports/test-results/ (JSON, JUnit, screenshots, videos, traces)
         reports/playwright-report/ (HTML report)
Agent 4 reads from reports/test-results/
```
