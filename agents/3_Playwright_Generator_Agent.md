# Agent 3 — Playwright Test Generator

## Role
Generates a complete, production-ready Playwright test suite (Page Objects, test spec, test data)
from the feature spec and locator map, then **self-verifies and self-heals** it by running the
tests and repairing failures before hand-off. Generated code is **thin**: page objects extend the
generic `BasePage` and reference locators by key — the `codegenForm → primary → fallback` choice is
made at RUNTIME by `BasePage`/`ConfigLoader`, not hardcoded here.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Locator JSON | `features/{FeatureName}/locators/{FeatureName}_locators.json` | **Always required** |
| Feature spec | `features/{FeatureName}/spec/QA_{FeatureName}.md` | Pipeline Mode only |

**Outputs:**
| Output | Path |
|---|---|
| Page object(s) | `features/{FeatureName}/pages/{PageName}Page.ts` |
| Test suite | `features/{FeatureName}/tests/feature_{feature_name}.spec.ts` (split if large — see Step 5) |
| Test data | `features/{FeatureName}/testData/{feature_name}.json` |

**Shared toolkit (always reuse — never re-implement):**
| Module | Path | Use |
|---|---|---|
| `BasePage` | `shared/pages/BasePage.ts` | Base class for every page object: `goto/click/fill/selectOption/getText/loc/waitStable/waitEnabled` + runtime locator fallback |
| waits | `shared/utils/waits.ts` | `waitForStable/waitForEnabled/waitForVisibleAny/waitForGone` — **the only allowed waits** |
| assertions | `shared/assertions/common.ts` | `assertVisible/assertHidden/assertText/assertCount/assertUrl` |
| ConfigLoader | `shared/utils/ConfigLoader.ts` | `loadTestData`, `resolveLocator` (used internally by BasePage) |
| testData | `shared/utils/testData.ts` | `generateTestEmail()` → unique deliverable `{local}+{DDMMM}{nnn}@{domain}` alias of `TEST_EMAIL_BASE` (.env) for any form-fill email |

---

## Steps

### Step 0.5 — Detect Input Mode
- **Pipeline** — spec + locator JSON exist → spec drives AC grouping, scenarios, feasibility, test-data categories.
- **Standalone** — only locator JSON exists → read `featureName`/`featureSnakeCase` from its `metadata`; emit one `test.describe('{FeatureName} — Smoke')` with one visibility test per captured locator; tags `@smoke @functional`; minimal `validData`.
- **Locator JSON missing** → stop: "Run Agent 2 first — locator JSON is the minimum required input."

### Step 0 — Verify `playwright.config.ts`
Confirm: `dotenv.config()` at top; `baseURL: process.env.BASE_URL` (no hardcoded fallback); `dotenv`
in `package.json`. Fix and report any gap. **Do not change** the reporter set or the
`reports/test-results/` + `reports/playwright-report/` paths (Agent 4 hand-off invariant).

### Step 1 — Parse Spec (Pipeline only)
Extract feature names, ACs + scenarios (IDs, type, priority, feasibility), pre-conditions,
manual-only ACs, environment notes.

### Step 2 — Parse Locator Map
Extract page sections + element keys, `status`, `matchCount`, `finding` notes, URL constants, and
which ACs are covered vs. missing. **You do not pick a selector here** — you reference element keys;
`BasePage` resolves codegenForm→primary→fallback at runtime.

### Step 3 — Generate Test Data (`{feature_name}.json`)
Group: `validData` / `invalidData` / `edgeCases` (+ `users`, `knownData` as needed). Add an
**`expectedTexts`** group holding every assertion string (headings, error messages, labels) — tests
reference these, never inline string literals. Each entry has a `description` + AC ref. No production
credentials. Include URL constants.

**Email rule (deliverability):** Any email the app actually sends mail to (form-fill / data-entry
fields — applicant email, contact email, etc.) MUST be produced at runtime in the spec via
`generateTestEmail()` from `shared/utils/testData.ts` — never a dummy/disposable domain
(`@yopmail.com`, `@mailinator.com`, `@example.com`). Store only a sample value + a note in the JSON;
override it in the spec. Exceptions that stay hardcoded: login/admin accounts (must be real
provisioned users) and negative/boundary validation cases (`invalidEmailFormats`, max-length, RFC-2606
`*.invalid`) which intentionally never send.

### Step 4 — Generate Page Object(s) — THIN, extends BasePage

Rules:
1. `export class {PageName}Page extends BasePage` — constructor `super(page, '{FeatureName}')`.
2. **No hand-declared locators, no selector strings, no priority/strict-mode decision.** Access
   elements by key via inherited helpers: `this.click('{pageKey}', '{ElementKey}')`,
   `this.fill(...)`, `this.loc(...)` (returns a Locator for assertions). Keys are exactly the
   page-section and element names from the locator JSON.
3. All public methods `async`, each with a one-line JSDoc.
4. **No `waitForTimeout` / sleeps.** Use inherited `waitStable`/`waitEnabled` or the `waits.ts`
   helpers (e.g. after opening a dropdown/modal, after enabling a dependent field).
5. `navigate()` calls `this.goto('{relativePathConstant}')` — relative path only (Playwright
   prepends `baseURL`); never `process.env.BASE_URL + path`.
6. Store relative paths as `static readonly` constants.
7. If a locator entry has a `finding` of PRODUCT BUG / MISMATCH, the method still uses the key
   (runtime fallback handles selection); document the bug in the test via a `@functional`-only tag
   and a comment — do not bake the bug into the page object.

**Template:**
```typescript
import { Page } from '@playwright/test';
import { BasePage } from '../../../shared/pages/BasePage';

export class {PageName}Page extends BasePage {
  static readonly PATH = '/some/path';

  constructor(page: Page) {
    super(page, '{FeatureName}');
  }

  /** Navigate to the page and wait for DOM content loaded. */
  async navigate(): Promise<void> {
    await this.goto({PageName}Page.PATH);
  }

  /** Submit the form. */
  async submit(): Promise<void> {
    await this.click('{pageKey}', 'SaveButton');
  }

  /** Open the counties dropdown (waits for it to settle, not a fixed sleep). */
  async openCounties(): Promise<void> {
    await this.click('{pageKey}', 'CountiesDropdown');
    await this.waitStable('{pageKey}', 'CountiesDialog');
  }
}
```

### Step 5 — Generate Test Suite

Rules:
1. Group by `test.describe()` per AC (Pipeline) / per category (Standalone).
2. **No inline locators in test bodies.** Every element interaction goes through a page-object
   method or `pageObject.loc(page, element)`. The spec file imports page objects + test data +
   shared assertion helpers — not `page.getByRole(...)` literals.
3. Assertion strings come from `testData.expectedTexts.*`, never hardcoded.
4. Every `test()` has Scenario ID + AC ref in the title, A/A/A comment separators, and `{ tag: [...] }`.
5. Waits: only `waits.ts` helpers / `waitForURL` / `waitForLoadState`. **`waitForTimeout` is banned.**
6. Missing locator (`status: "missing"`): keep the test, comment out only the unavailable
   assertion with `// TODO(Agent2-rerun): capture {ElementKey}`.
7. Manual-only AC → automate what's possible + `// NOTE: full verification requires manual testing`.
8. **Split large suites:** if a feature would exceed ~600 lines, emit one spec file per page or per
   AC group — `feature_{feature_name}_{group}.spec.ts` — instead of one monolith.
9. Import paths from `tests/`: `../pages/`, `../testData/`, `../../../shared/...`.

### Step 5.1 — Test Tagging (mandatory)
| Condition | Tags |
|---|---|
| Happy Path · P1 · no destructive side-effect | `@smoke @regression @functional` |
| P1/P2 · not a known bug · not redundant | `@regression @functional` |
| Automatable / Partially Automatable | `@functional` |
| Security scenario | `@functional @security` (+`@regression` if P1) |
| Known product bug (`finding: PRODUCT BUG`) | `@functional` **only** |
| Manual Only | no tags, no `test()` |

### Step 5.5 — Self-Verification + Self-Heal Loop (run before hand-off)

Generation is a draft. Prove it green (or that remaining failures are real product bugs) **before**
handing to Agent 4. Up to **3 rounds**:

1. **Run** the exact hand-off command (Step 7) — do not invent a different reporter or path:
   ```bash
   npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --project=chromium
   ```
2. **Read failures** from `reports/test-results/results.json` (the existing JSON reporter — same
   artifact Agent 4 consumes; low-token, structured). Parse failing tests + error messages.
3. **Classify & repair each failure:**
   | Failure signal | Repair |
   |---|---|
   | Locator not found / 0 matches / timeout on a locator | Re-run the targeted extractor for that page (`npm run extract-locators -- --feature {FeatureName} --page {pageKey} --url {relUrl} --force`), then ensure the element key + interactions.json trigger exist. The runtime fallback usually fixes it once the JSON has a matching selector. |
   | Strict-mode (resolved to N elements) | Add scoping in the locator JSON (semantic container) via Agent 2 re-run, or use `.first()` only with a justifying comment. |
   | Timing / race (element not ready, animation) | Replace with a `waits.ts` helper (`waitForStable`/`waitForEnabled`/`waitForVisibleAny`). Never add `waitForTimeout`. |
   | Assertion text mismatch vs. spec | Confirm against live DOM. If the app genuinely differs from spec → **product finding**: mark the test `@functional`-only and `test.skip('… [SKIP: F-xxx] …')` with the evidence; record the finding. Do **not** silently weaken the assertion. |
   | Compile / import error | Fix imports/paths; re-run. |
4. **Re-run.** Repeat until green or only documented product-bug skips remain.
5. **Stop conditions:** all green, OR 3 rounds reached. Report any still-failing tests with their
   classification (never hand off an unexplained red).

> Evidence capture: `playwright.config.ts` keeps trace/screenshot/video for Agent 4. Leave it as-is.

### Step 6 — Validate Outputs
- Page objects `extends BasePage`, **zero** hand-declared selector strings, **zero** `waitForTimeout`.
- Test suite: no inline locators, assertion strings from `expectedTexts`, every title has Scenario
  ID + AC ref, `{ tag: [...] }` present, known-bug tests `@functional`-only, large suites split.
- Self-heal loop ran; final state is green or documented skips.

### Step 7 — Output Summary + Hand-off
Print a file table (path, lines, notes) + AC coverage table + self-heal summary (rounds run,
repaired, remaining product-bug skips). Then the **Hand-off to Agent 4** block below, verbatim.

---

## Framework Standards
| Standard | Value |
|---|---|
| Global timeout | from `shared/utils/timeouts.ts` (default 90 000 ms; override via `.env`) |
| Load state | `domcontentloaded` |
| Locators | by key via BasePage — runtime codegenForm→primary→fallback |
| Waits | `waits.ts` / `waitForURL` / `waitForLoadState` only — **`waitForTimeout` banned** |
| Assertions | `shared/assertions/common.ts`; strings from `testData.expectedTexts` |
| Isolation | no shared mutable state across tests |

## Error Handling
| Situation | Action |
|---|---|
| Locator JSON missing | Stop (run Agent 2 first) |
| Spec missing, locator JSON present | Standalone Mode |
| Missing locator | Keep test; comment out only the dependent assertion + `// TODO(Agent2-rerun)` |
| Manual-only AC | Automate what's possible + NOTE comment |
| Self-heal can't fix after 3 rounds | Report failing tests + classification; do not hide reds |
| Multiple pages | One page object file per page |

---

## Update Mode
**Trigger:** `Run Agent 3 update mode for {FeatureName}`.
1. Read `.ac_changes.json` (`changes.*`, `affectedTests.*`, `locatorStatus.newCaptured`). Stop if absent.
2. Map each `test()` → AC + Scenario ID from its title.
3. **New ACs:** append new `describe`/`test` blocks at end-of-file with an `// Added {date} — {task} | AC_xxx` header; append test data + page-object methods.
4. **Modified ACs:** minimum edits; `// UPDATED {date} — {reason}` above changed lines.
5. **Removed ACs:** wrap in `test.skip()` with a `// SKIPPED {date}` note — never delete.
6. Run Step 5.5 self-heal on changed files only. Validate changed sections (Step 6).

---

## Hand-off to Agent 4

```
Next: npx playwright test features/{FeatureName}/tests/feature_{feature_name}.spec.ts --project=chromium
Results → reports/test-results/ (JSON, JUnit, screenshots, videos, traces)
         reports/playwright-report/ (HTML report)
Agent 4 reads from reports/test-results/
```
