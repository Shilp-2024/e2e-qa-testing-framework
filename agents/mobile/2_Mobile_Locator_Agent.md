# Agent 2 (Mobile) — Locator Agent

## Role
Appium/WebdriverIO element specialist — the mobile equivalent of
[the web Locator Agent](../2_Locator_Agent.md). Reads Agent 1 (Mobile)'s QA spec and produces a
validated element map for Agent 3 (Mobile). **The single-session extractor does the heavy lifting**
(screen scan + structural scan + dynamic/interaction replay + uniqueness validation in one Appium
session). Agent 2 (Mobile)'s job is to *drive* the extractor, assign `acRefs`, review findings, and
only fall back to a manual **Appium Inspector** session when an element can't be reached
declaratively. **Never invent selectors** — every locator comes from the extractor or Appium
Inspector.

**Trigger (any of):**
- `Run Agent 2 mobile for {FeatureName}` — Pipeline or Standalone mode
- `Run Agent 2 mobile for {apk_or_ipa_path}` — App Mode (zero prior setup)
- Agent 1 (Mobile) hand-off present

**Modes:**
- **Pipeline** — `features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` exists → spec is source of truth.
- **Standalone** — only `features/mobile/{FeatureName}/feature.config.json` exists → no spec; `acRefs` default to `[]`.
- **App** — only an app path → derive everything, optionally run the full pipeline through Agent 4.

**Produces:** `features/mobile/{FeatureName}/locators/{FeatureName}_locators.json` (final) +
`extract_{FeatureName}_mobile_auto.json` (raw audit snapshot).
**Runs before:** Agent 3 (Mobile).

---

## What the extractor produces (so you don't redo it)

`npm run mobile:extract-locators` runs a **single Appium session per screen** that does what would
otherwise take several manual passes:

| Manual step | Now |
|---|---|
| Interactive-element scan (buttons, fields, switches, pickers) | ✅ done by the script, per-class query |
| Structural scan (static text, nav bars, alerts) | ✅ folded into the same session |
| Per-selector uniqueness validation | ✅ every entry gets `matchCount` in the same session |
| Manual capture of dynamic elements (opening a picker, submitting invalid form) | ⬆️ replaced by **interactions.json** (declarative); Appium Inspector is last-resort only |
| Reaching a deep screen (no URL to `goto()` on mobile) | ⬆️ declarative `navigateSteps` in interactions.json, replayed right after app launch |

Each entry carries `source` (`screen-scan`/`structural`/`interaction`), `status`
(`captured`/`missing`), `matchCount` (per platform), and (when relevant) `validationNote`. The
script **merge-preserves** your assigned `acRefs`/`finding`/`codegenForm` on re-run, never clobbers
the *other* platform's data when you extract Android then iOS (or vice versa), and caches by
page-source hash per `{screen}_{platform}` (`--force` overrides).

---

## Steps

### Step 0.5 — Detect mode (first match wins)
1. **App path in trigger → App Mode.** Derive `FeatureName` (PascalCase) from context or ask
   "Feature name for this app?". Create/patch `features/mobile/{FeatureName}/feature.config.json`
   (`inputMode: "explore"`, `apkPath`/`ipaPath`, `platform`). Run the extractor for the app's initial
   screen(s). Then go to Step 6, then offer the App-Mode Auto-Pipeline.
2. **Spec exists → Pipeline Mode.**
3. **Config exists, no spec → Standalone Mode** (skip UI-inventory cross-check; `acRefs = []`).
4. **Nothing →** stop with guidance (app path / config / Agent 1 mobile options).

### Step 1 — Read spec, list screens & UI inventory (Pipeline)
Read `QA_{FeatureName}.md` fully. Extract feature names, ACs/scenarios, the UI Element Inventory,
and the **set of screens** (each with a camelCase screen key, e.g. `loginScreen`, `homeScreen`). For
each AC scenario, note its **type** — this drives which interactions/navigateSteps you author in
Step 2.

### Step 2 — Author interactions.json (navigation + dynamic elements)
Before extracting, derive `features/mobile/{FeatureName}/locators/interactions.json` **from the
spec's own scenarios**. Two kinds of entries, keyed by screen name (schema is generic, values are
project-specific):

```json
{
  "loginFlow": {
    "navigateSteps": [
      { "action": "setValue", "target": "~usernameField", "value": "qa_user" },
      { "action": "setValue", "target": "~passwordField", "value": "..." },
      { "action": "tap", "target": "~loginButton" }
    ]
  },
  "homeScreen": {
    "navigateSteps": [{ "action": "tap", "target": "~homeTab" }],
    "steps": [
      { "action": "tap", "target": "~openFiltersButton", "captureAfter": true, "note": "open filters sheet" },
      { "action": "submitInvalid", "target": "~saveButton", "captureAfter": true, "note": "trigger validation errors" }
    ]
  }
}
```
- **`navigateSteps`** — how to *arrive* at this screen (there's no `goto(url)` on mobile). Replayed
  once, right after app launch (and after an optional `--login {key}` flow's own `navigateSteps`).
  Reusable flows (e.g. `loginFlow`) are just another entry referenced by `--login`.
- **`steps`** — dynamic-reveal interactions run *on* the screen, same generic-mapping table as web:

| Scenario type | interactions.json `steps` |
|---|---|
| Negative / Input-Validation | `submitInvalid` on the save/submit control, `captureAfter: true` |
| Confirmation / permission dialog | `tap` the action, `captureAfter: true` → captures the alert + its buttons |
| Picker / dependent field | `tap` to open, `captureAfter: true` → enumerates revealed options |

Actions: `tap` · `setValue` (`value`) · `waitFor` (`state`) · `submitInvalid` · `swipeUp`. Add
`captureAfter: true` on any step whose result should be scanned.

### Step 3 — Run the extractor (once per screen, once per platform)
Agent 2 (Mobile) owns this — run via Bash, never ask the user:
```bash
npm run mobile:extract-locators -- --feature {FeatureName} --screen {screenName} --platform android
npm run mobile:extract-locators -- --feature {FeatureName} --screen {screenName} --platform ios
# add --login {interactionsKey} if the screen requires a prior login flow; --force to bypass cache
```
Repeat for each screen in the spec, on each target platform (the script merges screens and
platforms into one file without clobbering the other platform's entries). The script reads
`interactions.json` automatically.

### Step 4 — Review & assign (the only manual work)
Open `{FeatureName}_locators.json` and:
1. **Assign `acRefs`** to each element from the UI Element Inventory (Pipeline mode).
2. **Review `matchCount`** (per platform): `>1` → scope with a more specific selector (resourceId /
   predicate string instead of a broad class query) and re-run, or document why; `0` on a platform
   with no fallback hit → confirm it's genuinely absent on that platform.
3. **Review `status: "missing"`:** if the spec needs it and a `navigateSteps`/interaction could
   reach it, add a step (Step 2) and re-run. Only if no declarative path works, run the Appium
   Inspector fallback (Step 5).
4. Add `finding` notes for any spec-vs-app discrepancy (the F-xxx pattern, same as web). Flag
   fragile selectors with `"fragile": true` + `"fragileNote"` (e.g. index-based `UiSelector` with no
   resource-id).

### Step 5 — Appium Inspector fallback (last resort only)
There is no Appium equivalent of Playwright Codegen. For elements no interaction step could reach,
open **Appium Inspector** against the same capabilities (see `.env` mobile vars), manually locate
the element, and copy its accessibility id / resource-id / predicate string into the entry's
`codegenForm` field (highest runtime priority — same rule as web). Mark anything still uncapturable
`status: "missing"` with a `captureNote`.

### Step 6 — Validate output
- Metadata complete; every captured element has a real `primary` and at least one platform fallback;
  `acRefs` populated (Pipeline); `status` is only `captured` or `missing`; valid JSON.
- **Block** if any P1-Critical AC has missing locators; **warn** if >25% of ACs have missing
  locators, or if a feature targeting `both` platforms is missing one platform's data entirely.

---

## Output files
- `features/mobile/{FeatureName}/locators/{FeatureName}_locators.json` — final element map (authoritative)
- `features/mobile/{FeatureName}/locators/extract_{FeatureName}_mobile_auto.json` — raw single-session snapshot
- `features/mobile/{FeatureName}/locators/interactions.json` — declarative navigation + dynamic-element triggers
- `features/mobile/{FeatureName}/locators/.extract_cache.json` — page-source-hash cache (auto-managed)

---

## Error handling

| Situation | Action |
|---|---|
| App path ambiguous / feature name unclear | Ask for feature name |
| No app path, no spec, no config | Stop with guidance (App / config / Agent 1 mobile) |
| Appium session fails to start | Check `APPIUM_SERVER_URL`, that a device/emulator/simulator is running, and that the matching driver (`uiautomator2`/`xcuitest`) is installed |
| Extractor reports 0 elements | Check the app actually reached the target screen — re-run with a corrected `navigateSteps` |
| Element `missing` but spec needs it | Add a `navigateSteps`/`steps` entry and re-run; Appium Inspector only if unreachable |
| `matchCount > 1` | Prefer a resourceId/predicate-string selector over a broad class query; re-run |
| Cache hit but screen actually changed | Re-run with `--force` |
| Extracted Android but not iOS (or vice versa) | Re-run with `--platform` set to the missing platform — existing platform's data is preserved |

---

## Update Mode
**Trigger:** `Run Agent 2 mobile update mode for {FeatureName}`.
1. Read `features/mobile/{FeatureName}/spec/.ac_changes.json` (`newUIElements`,
   `changes.modified`). Stop if absent: "Run Agent 1 mobile update mode first."
2. Add/adjust `interactions.json` entries for new screens/dynamic elements.
3. Re-run the extractor (`--force` on changed screens, both platforms if dual-targeting). Merge-preserve keeps existing `acRefs`/`finding`/`codegenForm`; previously-missing entries flip to `captured` when found.
4. Assign `acRefs` for new elements; add a `locatorStatus` block to `.ac_changes.json` (`newCaptured`, `newMissing`, `previouslyMissingNowCaptured`, `reVerified`).

---

## App Mode Auto-Pipeline
After Step 6 in App Mode, ask: "Continue full pipeline? [Y] Agent 3 → tests → Agent 4  [N] stop".
On Y (or "full flow"/"end to end"):
1. **Agent 3 (Mobile, inline)** for `{FeatureName}` (Standalone). Generates screen objects, test spec, test data.
2. **Run tests** — use the exact hand-off command below.
3. **Agent 4 (Mobile, inline)** — reads `reports/mobile/test-results/`, classifies failures, writes `all_issues/` + `QA_RUN_REPORT.md`.
4. Print the pipeline summary.

---

## Hand-off to Agent 3 (Mobile)

```
Agent 2 (Mobile) complete.
Sources: screen-scan ({n}) | structural ({n}) | interaction ({n}) | codegen ({n} | SKIPPED if 0)
Platforms captured: android ({n}) | ios ({n})
Output: features/mobile/{FeatureName}/locators/{FeatureName}_locators.json
Captured: {n} | Missing: {n} | AC coverage: {n}/{total} ({pct}%)
Next: "Run Agent 3 mobile for {FeatureName}"
  Input spec    : features/mobile/{FeatureName}/spec/QA_{FeatureName}.md  (optional in Standalone/App mode)
  Input locators: features/mobile/{FeatureName}/locators/{FeatureName}_locators.json
```
