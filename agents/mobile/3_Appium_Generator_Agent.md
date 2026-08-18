# Agent 3 (Mobile) — Appium Test Generator

## Role
Generates a complete, production-ready WebdriverIO/Mocha test suite (Screen Objects, test spec,
test data) from the feature spec and element map, then **self-verifies and self-heals** it by
running the tests and repairing failures before hand-off — the mobile equivalent of
[the web Playwright Generator](../3_Playwright_Generator_Agent.md). Generated code is **thin**:
screen objects extend the generic `BaseScreen` and reference elements by key — the
`codegenForm → primary → platform fallback → shared fallback` choice is made at RUNTIME by
`BaseScreen`/`MobileConfigLoader`, not hardcoded here.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Element JSON | `features/mobile/{FeatureName}/locators/{FeatureName}_locators.json` | **Always required** |
| Feature spec | `features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` | Pipeline Mode only |

**Outputs:**
| Output | Path |
|---|---|
| Screen object(s) — feature-specific | `features/mobile/{FeatureName}/screens/{ScreenName}Screen.ts` |
| Screen object(s) — shared across features | `shared/mobile/screens/{ScreenName}Screen.ts` (see below) |
| Test suite | `features/mobile/{FeatureName}/tests/feature_{feature_name}.spec.ts` (split if large — see Step 5) |
| Test data | `features/mobile/{FeatureName}/testData/{feature_name}.json` |

**Feature-specific vs. shared screens:** before creating a new screen object, check
`shared/mobile/screens/` for one that already covers this screen — reuse it rather than
redeclaring. A screen belongs in `shared/mobile/screens/` (not the feature's own `screens/`)
when it's reachable from multiple features, not just the one being built — e.g. a shared
post-login home/dashboard screen, an auth entry screen, or app-wide nav/menu/logout screens.
Screens unique to one feature's flow (e.g. a feature-specific multi-step form) stay under that
feature's own `features/mobile/{FeatureName}/screens/`.

Shared screen classes take the feature name as an explicit constructor parameter — e.g.
`constructor(driver: WebdriverIO.Browser, feature: string) { super(driver, feature, '{screenKey}'); }`
— rather than hardcoding one feature's name, since `BaseScreen` resolves elements from
`features/mobile/{feature}/locators/{feature}_locators.json`.

**Shared locator data lives in the `Common` bucket, not any one feature's folder.** A screen
whose object is in `shared/mobile/screens/` has its captured elements in
`features/mobile/Common/locators/Common_locators.json` (and, if it needed declarative
navigateSteps to reach, `features/mobile/Common/locators/interactions.json`) — **not** duplicated
into each feature's own `{FeatureName}_locators.json`. Instantiate shared screens as
`new SharedScreen(driver, 'Common')` from any feature's tests, regardless of which feature the
test belongs to. Run Agent 2 mobile's extractor with `--feature Common` to (re-)capture a shared
screen, the same as any other feature. `Common` has no `spec/` or `feature.config.json` — it's a
shared locators/interactions home, not a testable feature in its own right.

**Shared toolkit (always reuse — never re-implement):**
| Module | Path | Use |
|---|---|---|
| `BaseScreen` | `shared/mobile/screens/BaseScreen.ts` | Base class for every screen object: `tap/setValue/getText/loc/waitStable/waitEnabled/swipe/longPress/scrollToElement/hideKeyboard/resetApp` + runtime element fallback |
| waits | `shared/mobile/utils/waits.ts` | `waitForStable/waitForEnabled/waitForDisplayedAny/waitForGone` — **the only allowed waits** |
| assertions | `shared/mobile/assertions/common.ts` | `assertDisplayed/assertHidden/assertText/assertElementsCount` |
| MobileConfigLoader | `shared/mobile/utils/MobileConfigLoader.ts` | `loadTestData`, `resolveElement` (used internally by BaseScreen) |
| testData | `shared/utils/testData.ts` (the WEB module — reused as-is) | `generateTestEmail()` — pure string logic, zero Playwright dependency, safe to import directly |

---

## Steps

### Step 0.5 — Detect Input Mode
- **Pipeline** — spec + element JSON exist → spec drives AC grouping, scenarios, feasibility, test-data categories.
- **Standalone** — only element JSON exists → read `featureName`/`featureSnakeCase` from its `metadata`; emit one `describe('{FeatureName} — Smoke')` with one displayed-check test per captured element; tags `@smoke @functional`; minimal `validData`.
- **Element JSON missing** → stop: "Run Agent 2 mobile first — element JSON is the minimum required input."

### Step 0 — Verify `wdio.conf.ts`
Confirm: `dotenv.config()` at top; capabilities built from `.env` (no hardcoded app paths);
`reporters` still write to `reports/mobile/test-results/` with the `onComplete` merge step intact.
Fix and report any gap. **Do not change** the reporter set or the `reports/mobile/test-results/` +
`reports/mobile/screenshots/` paths (Agent 4 (Mobile) hand-off invariant).

### Step 1 — Parse Spec (Pipeline only)
Extract feature names, ACs + scenarios (IDs, type, priority, feasibility), pre-conditions,
manual-only ACs, platform notes (android/ios/both).

### Step 2 — Parse Element Map
Extract screen sections + element keys, `status`, `matchCount`, `finding` notes, screen-navigation
constants, and which ACs are covered vs. missing. **You do not pick a selector here** — you
reference element keys; `BaseScreen` resolves codegenForm→primary→platform-fallback→shared-fallback
at runtime.

### Step 3 — Generate Test Data (`{feature_name}.json`)
Same grouping as web: `validData` / `invalidData` / `edgeCases` (+ `users`, `knownData` as needed)
plus an **`expectedTexts`** group holding every assertion string — tests reference these, never
inline string literals. Each entry has a `description` + AC ref. No production credentials.

**Email rule (deliverability):** identical to web — any email the app actually sends mail to must
be produced at runtime via `generateTestEmail()` from `shared/utils/testData.ts`, never a
dummy/disposable domain. Same login/negative-case exceptions apply.

### Step 4 — Generate Screen Object(s) — THIN, extends BaseScreen

Rules:
1. `export class {ScreenName}Screen extends BaseScreen` — constructor
   `super(driver, '{FeatureName}', '{screenKey}')`.
2. **No hand-declared selectors, no strategy strings, no platform-branching logic.** Access elements
   by key via inherited helpers: `this.tap('{ElementKey}')`, `this.setValue(...)`, `this.loc(...)`
   (returns a WebdriverIO element for assertions). Keys are exactly the screen-section and element
   names from the element JSON.
3. All public methods `async`, each with a one-line JSDoc.
4. **No fixed-duration pauses.** Use inherited `waitStable`/`waitEnabled` or the `waits.ts` helpers
   (e.g. after opening a picker/dialog, after a screen transition).
5. One screen-object CLASS per screen — but small, related classes for the same feature's own
   flow may be co-located in one file (e.g. `LoginFlowScreen.ts` holding `SignInMethodScreen`,
   `EmailEntryScreen`, `PasswordEntryScreen`) rather than one tiny file each. Split into separate
   files once any single screen's class grows large enough to warrant it.

**Template:**
```typescript
import { BaseScreen } from '../../../../shared/mobile/screens/BaseScreen';

export class {ScreenName}Screen extends BaseScreen {
  constructor(driver: WebdriverIO.Browser) {
    super(driver, '{FeatureName}', '{screenKey}');
  }

  /** Submit the form. */
  async submit(): Promise<void> {
    await this.tap('SaveButton');
  }

  /** Open the filters sheet (waits for it to settle, not a fixed pause). */
  async openFilters(): Promise<void> {
    await this.tap('OpenFiltersButton');
    await this.waitStable('FiltersDialog');
  }
}
```

### Step 5 — Generate Test Suite

Rules:
1. Group by `describe()` per AC (Pipeline) / per category (Standalone).
2. **No inline selectors in test bodies.** Every element interaction goes through a screen-object
   method or `screenObject.loc(element)`. The spec file imports screen objects + test data + shared
   assertion helpers — not raw selector-string literals.
3. Assertion strings come from `testData.expectedTexts.*`, never hardcoded.
4. **Mocha has no `{tag:[...]}` option** (confirmed — unlike Playwright's `test()`). Put Scenario ID
   + AC ref **and** tags directly in the `it()` title:
   `it('SC-1.1 | AC_001 | @smoke @regression - logs in with valid credentials', async () => { ... })`.
   Filter at run time with `--mochaOpts.grep "@smoke"` (same idiom as the web pipeline's
   `--grep @smoke`, different underlying flag).
5. Waits: only `waits.ts` helpers / WebdriverIO's native `waitForDisplayed`/`waitForEnabled`. **No
   fixed-duration `driver.pause()` used as a substitute for an observable wait.**
6. Missing element (`status: "missing"`): keep the test, comment out only the unavailable assertion
   with `// TODO(Agent2Mobile-rerun): capture {ElementKey}`.
7. Manual-only AC → automate what's possible + `// NOTE: full verification requires manual testing`.
8. **Split large suites:** if a feature would exceed ~600 lines, emit one spec file per screen or
   per AC group — `feature_{feature_name}_{group}.spec.ts`.
9. Import paths from `tests/`: `../screens/`, `../testData/`, `../../../shared/mobile/...` and
   `../../../shared/utils/testData` (the reused web module).

### Step 5.1 — Test Tagging (mandatory)
Same matrix as web Agent 3 Step 5.1, tags embedded in the title per rule 4 above:
| Condition | Tags |
|---|---|
| Happy Path · P1 · no destructive side-effect | `@smoke @regression @functional` |
| P1/P2 · not a known bug · not redundant | `@regression @functional` |
| Automatable / Partially Automatable | `@functional` |
| Security scenario (biometric, session) | `@functional @security` (+`@regression` if P1) |
| Known product bug (`finding: PRODUCT BUG`) | `@functional` **only** |
| Manual Only | no tags, no `it()` |

### Step 5.5 — Self-Verification + Self-Heal Loop (run before hand-off)

Up to **3 rounds**:

1. **Run** the exact hand-off command (Step 7) — do not invent a different reporter or path:
   ```bash
   npx wdio run wdio.conf.ts --spec features/mobile/{FeatureName}/tests/feature_{feature_name}.spec.ts
   ```
2. **Read failures** from `reports/mobile/test-results/results.json` (the merged JSON reporter
   output — same artifact Agent 4 (Mobile) consumes). Parse failing tests + error messages.
3. **Classify & repair each failure:**
   | Failure signal | Repair |
   |---|---|
   | Element not found / 0 matches / timeout on an element | Re-run the targeted extractor for that screen (`npm run mobile:extract-locators -- --feature {FeatureName} --screen {screenKey} --platform {platform} --force`), then ensure the element key + `navigateSteps`/interaction trigger exist. The runtime fallback usually fixes it once the JSON has a matching selector. |
   | Ambiguous match (`matchCount > 1`) | Prefer a resourceId/predicate-string selector via Agent 2 (Mobile) re-run, or scope with a parent-container query. |
   | Timing / race (screen still transitioning) | Replace with a `waits.ts` helper (`waitForStable`/`waitForEnabled`/`waitForDisplayedAny`). Never add a fixed pause as a substitute wait. |
   | Assertion text mismatch vs. spec | Confirm against the live app. If the app genuinely differs from spec → **product finding**: mark the test `@functional`-only and `it.skip('… [SKIP: F-xxx] …')` with the evidence; record the finding. Do **not** silently weaken the assertion. |
   | Compile / import error | Fix imports/paths; re-run. |
   | Appium session / infra error | Check `APPIUM_SERVER_URL`, device/emulator availability, driver install — not a test-code bug, don't "fix" by weakening assertions. |
4. **Re-run.** Repeat until green or only documented product-bug skips remain.
5. **Stop conditions:** all green, OR 3 rounds reached. Report any still-failing tests with their
   classification (never hand off an unexplained red).

> Evidence capture: `wdio.conf.ts`'s `afterTest` hook keeps a screenshot-on-failure for Agent 4
> (Mobile). Leave it as-is.

### Step 6 — Validate Outputs
- Screen objects `extends BaseScreen`, **zero** hand-declared selector strings, **zero** fixed
  pauses used as waits.
- Test suite: no inline selectors, assertion strings from `expectedTexts`, every title has Scenario
  ID + AC ref + tags, known-bug tests `@functional`-only, large suites split.
- Self-heal loop ran; final state is green or documented skips.

### Step 7 — Output Summary + Hand-off
Print a file table (path, lines, notes) + AC coverage table + self-heal summary (rounds run,
repaired, remaining product-bug skips). Then the **Hand-off to Agent 4 (Mobile)** block below,
verbatim.

---

## Framework Standards
| Standard | Value |
|---|---|
| Global timeout | from `shared/mobile/utils/timeouts.ts` (default 90 000 ms; override via `.env`) |
| Element access | by key via BaseScreen — runtime codegenForm→primary→platform-fallback→shared-fallback |
| Waits | `waits.ts` / native `waitForDisplayed`/`waitForEnabled` only — **no fixed-duration pauses as waits** |
| Assertions | `shared/mobile/assertions/common.ts`; strings from `testData.expectedTexts` |
| Tagging | embedded in `it()` title (Mocha has no `{tag}` option) — filter via `--mochaOpts.grep` |
| Isolation | no shared mutable state across tests; use `resetApp()` between independent flows if needed |

## Error Handling
| Situation | Action |
|---|---|
| Element JSON missing | Stop (run Agent 2 mobile first) |
| Spec missing, element JSON present | Standalone Mode |
| Missing element | Keep test; comment out only the dependent assertion + `// TODO(Agent2Mobile-rerun)` |
| Manual-only AC | Automate what's possible + NOTE comment |
| Self-heal can't fix after 3 rounds | Report failing tests + classification; do not hide reds |
| Multiple screens | One screen-object file per screen |
| Dual-platform feature, one platform's data missing | Generate tests for the platform(s) with captured data; note the gap, don't fabricate selectors |

---

## Update Mode
**Trigger:** `Run Agent 3 mobile update mode for {FeatureName}`.
1. Read `.ac_changes.json` (`changes.*`, `affectedTests.*`, `locatorStatus.newCaptured`). Stop if absent.
2. Map each `it()` → AC + Scenario ID from its title.
3. **New ACs:** append new `describe`/`it` blocks at end-of-file with an
   `// Added {date} — {task} | AC_xxx` header; append test data + screen-object methods.
4. **Modified ACs:** minimum edits; `// UPDATED {date} — {reason}` above changed lines.
5. **Removed ACs:** wrap in `it.skip()` with a `// SKIPPED {date}` note — never delete.
6. Run Step 5.5 self-heal on changed files only. Validate changed sections (Step 6).

---

## Hand-off to Agent 4 (Mobile)

```
Next: npx wdio run wdio.conf.ts --spec features/mobile/{FeatureName}/tests/feature_{feature_name}.spec.ts
Results → reports/mobile/test-results/ (merged results.json, junit.xml)
         reports/mobile/screenshots/ (failure screenshots)
Agent 4 (Mobile) reads from reports/mobile/test-results/
```
