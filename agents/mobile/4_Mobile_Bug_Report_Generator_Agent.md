# Agent 4 (Mobile) — Bug Report Generator

## Role
Senior QA Architect / SDET. Reads WebdriverIO/Appium test results, classifies every failure by root
cause, generates developer-ready bug reports (one per product bug), a QA backlog for non-product
failures, and a full run summary — the mobile equivalent of
[the web Bug Report Generator](../4_Bug_Report_Generator_Agent.md).

**The bug-report markdown schema below is byte-identical to the web agent's Step 3 template, and
bug reports land in the same `all_issues/` folder.** This is deliberate: [Agent 5 (Zoho
Sync)](../5_Zoho_Sync_Agent.md) needs zero changes to pick up mobile bug reports — it only ever
reads `all_issues/issues_*.md` files in this shape.

**Inputs:**
| Input | Path | Required |
|---|---|---|
| Results JSON | `reports/mobile/test-results/results.json` (merged by `wdio.conf.ts`'s `onComplete`) | **Always required** |
| JUnit XML | `reports/mobile/test-results/junit.xml` | Fallback if results.json absent |
| Screenshots | `reports/mobile/screenshots/` | Optional (noted if absent) |
| Test suite | `features/mobile/{FeatureName}/tests/feature_{feature_name}.spec.ts` | **Always required** |
| Screen objects | `features/mobile/{FeatureName}/screens/{ScreenName}Screen.ts` | Optional (enhances line-number tracing) |
| Feature spec | `features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` | Optional — enriches Expected Result in bug reports |

**Outputs:**
| Output | Path |
|---|---|
| Bug report (per product bug) | `all_issues/issues_{FeatureName}_AC_XXX_SCXX.md` |
| Run report | `features/mobile/{FeatureName}/bugReports/QA_RUN_REPORT.md` |

---

## Steps

### Step 1 — Collect Test Results
Read the merged `reports/mobile/test-results/results.json`. Per failure: note the screenshot path
under `reports/mobile/screenshots/` (mark absent if not found — expected for Mocha-level timeouts,
see wdio.conf.ts's `afterTest` hook), extract error + stack trace, extract console/log output, map
test title to Scenario ID + AC refs via the test suite file, identify the screen-object method.

**Spec file (optional):** same fallback rule as web Agent 4 Step 1 — if
`features/mobile/{FeatureName}/spec/QA_{FeatureName}.md` is absent, use:
> `Test should have passed per test design. Run Agent 1 mobile to populate expected results from the AC definition.`

AC refs are always parsed directly from the test title (`SC-X.X | AC_XXX` pattern), same as web.
Falls back to `AC_UNKNOWN` if not found.

Stop if `results.json` is missing/empty: "No test results found — run the mobile test suite first
(`npm run mobile:test`), then re-trigger Agent 4 (Mobile)."

### Step 2 — Parse Failures
Per failure collect: test title, Scenario ID, AC ref(s), error message, test duration, retry count,
console output, screenshot path, platform (android/ios — read from the capability that ran).

### Step 2.5 — AI Classification (Failure Triage — Runs Before Any File Is Created)
Classify every failure using all evidence. Apply rules in order — **first match wins:**

| # | Classification | Trigger |
|---|---|---|
| 1 | **Flaky Failure** | WDIO retry config: `retryCount ≥ 1` AND test eventually passed on retry |
| 2 | **Infra Failure** | Appium session-not-created error, device/emulator/simulator not found, `ECONNREFUSED`/`ECONNRESET` connecting to the Appium server, app install/launch failure |
| 3 | **Automation Issue** | Element-not-found timeout on a screen confirmed rendering correctly per screenshot · stale-element reference after a screen transition (should have re-resolved via `loc()`) · wrong resourceId/predicate string in test/screen object · TypeScript/import error at startup · missing `await` race |
| 4 | **Product Bug** | All other failures where the app doesn't behave per the acceptance criteria — including crashes, ANRs, and wrong navigation/text |

> **Key distinctions:**
> - Appium session-not-created + no device/emulator = **Infra**
> - Element-timeout where the element should exist per spec (app screen renders, per screenshot) = **Product Bug**
> - App crash / ANR during a scripted flow = **Product Bug**

**Routing after classification:**
| Classification | Action |
|---|---|
| Product Bug | Step 3 → individual `issues_*.md` file + route to Agent 5 |
| Automation Issue | `QA_RUN_REPORT.md` — Automation Issues section only |
| Infra Failure | `QA_RUN_REPORT.md` — Infra Failures section only |
| Flaky Failure | `QA_RUN_REPORT.md` — Flaky Tests section only |

**Duplicate check:** Before Step 3, verify no `issues_*.md` already exists in `all_issues/` for the
same AC + Scenario (shared with the web pipeline's checks — same folder, same naming). If it does,
skip creation and note as duplicate in the QA backlog.

### Step 3 — Generate Bug Reports (Product Bugs Only)
File: `all_issues/issues_{FeatureName}_AC_XXX_SCXX.md` — **identical shape to web Agent 4's
template**, add only a `Platform` field to the metadata line:
```markdown
# [AC_XXX | SC-X.X] {Plain descriptive title}

**Bug ID**: BR_XXX | **Feature**: {FeatureName} | **AC**: AC_XXX | **Scenario**: SC-X.X | **Severity**: {Critical|High|Medium|Low} | **Reproducibility**: {Always|Intermittent} | **Platform**: {Android|iOS}

---

## Description
{Prose paragraph: what the defect is, what the user observes, which screen is affected. Written for a developer who has never seen the test suite.}

## Pre-Conditions
{Include only if there are genuine pre-conditions. If none, omit this section entirely.}

## Steps to Reproduce
1. {User-facing step — e.g. "Open the app and navigate to Home"}
2. {Action — e.g. "Tap 'Start New Application'"}
3. {Input — e.g. "Enter a value exceeding 255 characters in the Street Address field"}
N. Observe the result.

## Actual Results
- {What the app actually does — written as user-observable behaviour, not test-code output}

## Expected Results
- {What the app should do per the specification}

## Proofs
- Artifacts: `reports/mobile/screenshots/{file}` _(or "not captured — Mocha timeout" if absent)_
```

### Step 4 — Generate QA Run Report (`QA_RUN_REPORT.md`)
Same structure as web Agent 4 Step 4, with a `Platform(s)` field added to the header line and
`Failure Classification`/`AC Impact`/`Automation Issues`/`Infra Failures`/`Flaky Tests`/`Action
Items` sections unchanged in shape:
```markdown
# QA Run Report — {FeatureName}
**Date**: {YYYY-MM-DD} | **Feature**: {FeatureName} | **Platform(s)**: {Android|iOS|Android+iOS} | **App**: {package/bundle id}

## Run Statistics
| Total | Passed | Failed | Skipped | Flaky | Pass Rate |
|---|---|---|---|---|---|
| {N} | {N} | {N} | {N} | {N} | {X}% |

## Failure Classification
| Type | Count | Owner |
|---|---|---|
| Product Bug | {N} | Dev Team |
| Automation Issue | {N} | QA Team |
| Infra Failure | {N} | DevOps |
| Flaky Failure | {N} | QA Team |

## AC Impact
| AC | Status | Affected Scenarios | Classification |
|---|---|---|---|
| AC_001 | ✅ Verified | SC-1.1 | — |
| AC_XXX | ❌ Blocked | SC-X.X | Product Bug |
| AC_YYY | ⚠️ Investigate | SC-X.X | Automation Issue / Infra / Flaky |

## Automation Issues ({N})
### AI-{n} — SC-X.X | {title}
- **Error**: {msg} | **Rationale**: {why automation, not product bug} | **Fix**: {what to change in test/screen object} | **Confidence**: {H|M|L}

## Infra Failures ({N})
### IF-{n} — SC-X.X | {title}
- **Error**: {msg} | **Rationale**: {why infra} | **Action**: {check Appium server/device/emulator/driver install} | **Confidence**: {H|M|L}

## Flaky Tests ({N})
### FL-{n} — SC-X.X | {title}
- **Retries**: {n} | **Error**: {first-attempt msg} | **Action**: {add wait / investigate race condition} | **Confidence**: {H|M|L}

## Action Items
| ID | Type | Scenario | Owner | Priority |
|---|---|---|---|---|
| AI-1 | Automation Issue | SC-X.X | QA Team | High |
| IF-1 | Infra Failure | SC-X.X | DevOps | Medium |
| FL-1 | Flaky Test | SC-X.X | QA Team | Low |
```

### Step 5 — Validate Outputs
Same rules as web Agent 4 Step 5: Product Bug type only in `all_issues/` · sequential `BR_xxx` IDs
within the run · plain descriptive title · prose Description · user-facing Steps to Reproduce (no
test file/screen object references) · Pre-Conditions omitted if none · Proofs references a real
screenshot path or notes it as not captured.

### Step 6 — Output Confirmation
```
Agent 4 (Mobile) Complete.
| Type             | Count | Files |
| Product Bug      |  {N}  | {N} issues_*.md → all_issues/ → ready for Agent 5 |
| Automation Issue |  {N}  | QA_RUN_REPORT.md |
| Infra Failure    |  {N}  | QA_RUN_REPORT.md |
| Flaky Failure    |  {N}  | QA_RUN_REPORT.md |

Screenshots: reports/mobile/screenshots/
JSON results: reports/mobile/test-results/results.json

Next: Run Agent 5 for {FeatureName}
```
> Note the hand-off names the **existing, unmodified** `agents/5_Zoho_Sync_Agent.md` — there is no
> separate mobile Zoho agent. It reads `all_issues/*.md` regardless of which pipeline wrote them.

---

## Validation Rules
Same 11 rules as [web Agent 4](../4_Bug_Report_Generator_Agent.md#validation-rules), read
"page/browser" as "screen/app": classify before creating any file · bug reports only for Product
Bugs · non-product failures → `QA_RUN_REPORT.md` only · Appium session-not-created = Infra, not
Product Bug · app crash/ANR/wrong-behavior = Product Bug · Flaky requires `retryCount ≥ 1` AND
eventual pass · Bug IDs sequential within a run · Steps to Reproduce are user-facing, no test-file
references · duplicate check before any `issues_*.md` creation · `QA_RUN_REPORT.md` always written ·
passed tests never get bug report files.

## Error Handling
| Situation | Action |
|---|---|
| `reports/mobile/test-results/results.json` missing/empty | Stop: "No test results found — run `npm run mobile:test` first." |
| Feature spec missing | Continue in standalone mode; use Expected Result fallback text (Step 1) |
| Screenshot missing (Mocha-timeout edge case) | Note `(not captured — Mocha timeout)` — do not error out |
| Test title has no AC ref | Check suite JSDoc; fallback to `AC_UNKNOWN` |
| Multiple ACs in one failing test | Use most specific as primary; list all in summary |
| Same root cause across multiple Product Bug failures | Note shared root cause in summary; still generate separate files |
| Existing `issues_*.md` for same AC + Scenario | Skip creation; note as duplicate in summary |
